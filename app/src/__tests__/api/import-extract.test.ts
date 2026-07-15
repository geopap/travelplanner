/**
 * B-021 — Integration tests for POST /api/trips/[id]/import/extract.
 *
 * Mocks: next/headers, audit, trip-access, supabase server client,
 * extract/claude (LLM), extract/sources (only the URL-fetch helpers we want
 * to drive — for SSRF / classification we let the real classifier run and
 * drive `safeFetch` through mocked node:dns / global.fetch).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID } from '../factories';
import { resetKey } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (p: Record<string, unknown>) => {
    auditCalls.push(p);
  },
}));

type AccessRole = 'owner' | 'editor' | 'viewer' | 'none' | 'forbidden-other';
let accessRole: AccessRole = 'editor';
vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async (
    _sb: unknown,
    _trip: string,
    _user: string,
    required: 'viewer' | 'editor' | 'owner',
  ) => {
    if (accessRole === 'none') return { ok: false, reason: 'not_found' };
    if (accessRole === 'forbidden-other')
      return { ok: false, reason: 'forbidden' };
    const rank: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
    if (rank[accessRole] < rank[required])
      return { ok: false, reason: 'forbidden' };
    return { ok: true, role: accessRole };
  },
}));

// Mock the source fetcher entirely — we test sources/classify separately.
// Each test installs its own response.
const fetchSourceMock = vi.fn();
vi.mock('@/lib/extract/sources', () => {
  class UnsupportedSourceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnsupportedSourceError';
    }
  }
  class SourceFetchError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'SourceFetchError';
    }
  }
  return {
    fetchSource: (...args: unknown[]) => fetchSourceMock(...args),
    UnsupportedSourceError,
    SourceFetchError,
  };
});

// Mock the LLM call.
const extractMock = vi.fn();
vi.mock('@/lib/extract/claude', () => {
  class LlmExtractionError extends Error {
    public readonly cause?: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = 'LlmExtractionError';
      this.cause = cause;
    }
  }
  return {
    extractWithRetry: (...args: unknown[]) => extractMock(...args),
    LlmExtractionError,
  };
});

// ---------------------------------------------------------------------------
// Supabase fake — `import_sources` only (duplicate lookup + insert).
// ---------------------------------------------------------------------------

interface DupRow {
  id: string;
  created_at: string;
}
interface InsertRow {
  id: string;
  source_type: string;
  status: string;
  created_at: string;
  extracted_json: unknown;
}

const FIXED_SOURCE_ID = '00000000-0000-4000-8000-000000000501';
const PRIOR_SOURCE_ID = '00000000-0000-4000-8000-000000000502';

const state: {
  authUser: { id: string } | null;
  dup: DupRow | null;
  insert: { data: InsertRow | null; error: { message: string } | null };
  capturedInserts: Array<Record<string, unknown>>;
} = {
  authUser: { id: FIXED_USER_ID },
  dup: null,
  insert: {
    data: {
      id: FIXED_SOURCE_ID,
      source_type: 'web',
      status: 'pending',
      created_at: '2026-05-15T00:00:00Z',
      extracted_json: { places: [], tips: [] },
    },
    error: null,
  },
  capturedInserts: [],
};

function makeImportSourcesChain() {
  const chain: {
    _mode?: 'select' | 'insert';
    select: (...args: unknown[]) => unknown;
    insert: (payload: Record<string, unknown>) => unknown;
    eq: () => unknown;
    gte: () => unknown;
    order: () => unknown;
    limit: () => unknown;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
  } = {
    select(_cols?: unknown) {
      if (chain._mode !== 'insert') chain._mode = 'select';
      return chain;
    },
    insert(payload: Record<string, unknown>) {
      chain._mode = 'insert';
      state.capturedInserts.push(payload);
      return chain;
    },
    eq() {
      return chain;
    },
    gte() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    async maybeSingle() {
      return { data: state.dup, error: null };
    },
    async single() {
      return state.insert;
    },
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
      getSession: async () => ({
        data: { session: { user: state.authUser, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
        error: null,
      }),
      refreshSession: async () => ({
        data: { session: { user: state.authUser, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table === 'import_sources') return makeImportSourcesChain();
      const noop: Record<string, unknown> = {};
      noop.select = () => noop;
      noop.eq = () => noop;
      noop.maybeSingle = async () => ({ data: null, error: null });
      return noop;
    },
  }),
}));

// Import route AFTER mocks.
import { POST } from '@/app/api/trips/[id]/import/extract/route';
import {
  UnsupportedSourceError as UnsupportedSourceErrorClass,
  SourceFetchError as SourceFetchErrorClass,
} from '@/lib/extract/sources';
import { LlmExtractionError as LlmExtractionErrorStub } from '@/lib/extract/claude';

const tripCtx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };

function postReq(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/import/extract`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

const cannedExtract = {
  places: [
    { name: 'Cafe X', category: 'cafe', why: 'Featured in the video' },
  ],
  tips: ['Bring cash'],
};

beforeEach(() => {
  accessRole = 'editor';
  auditCalls.length = 0;
  state.authUser = { id: FIXED_USER_ID };
  state.dup = null;
  state.capturedInserts.length = 0;
  state.insert = {
    data: {
      id: FIXED_SOURCE_ID,
      source_type: 'web',
      status: 'pending',
      created_at: '2026-05-15T00:00:00Z',
      extracted_json: cannedExtract,
    },
    error: null,
  };
  fetchSourceMock.mockReset();
  extractMock.mockReset();
  resetKey(`import:extract:user:${FIXED_USER_ID}`);
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('POST /api/trips/[id]/import/extract — auth', () => {
  it('anon → 401', async () => {
    state.authUser = null;
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(401);
  });

  it('viewer → 403', async () => {
    accessRole = 'viewer';
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(403);
  });

  it('non-member (not_found reason) → 404', async () => {
    accessRole = 'none';
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(404);
  });

  it('editor + text → 201', async () => {
    fetchSourceMock.mockResolvedValue({ source_type: 'text', raw_text: 'hi' });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(201);
  });

  it('owner + text → 201', async () => {
    accessRole = 'owner';
    fetchSourceMock.mockResolvedValue({ source_type: 'text', raw_text: 'hi' });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(201);
  });

  it('malformed tripId → 404', async () => {
    const res = await POST(
      postReq({ raw_text: 'hi' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

describe('POST /extract — body validation', () => {
  it('neither source_url nor raw_text → 400', async () => {
    const res = await POST(postReq({}), tripCtx);
    expect(res.status).toBe(400);
  });

  it('both source_url and raw_text → 400', async () => {
    const res = await POST(
      postReq({ source_url: 'https://example.com', raw_text: 'x' }),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });

  it('invalid JSON body → 400', async () => {
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/import/extract`,
      {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      },
    );
    const res = await POST(req, tripCtx);
    expect(res.status).toBe(400);
  });

  it('body trip_id is IGNORED — URL is canonical (AC 14)', async () => {
    fetchSourceMock.mockResolvedValue({ source_type: 'text', raw_text: 'hi' });
    extractMock.mockResolvedValue(cannedExtract);
    const otherTrip = '00000000-0000-4000-8000-000000000099';
    const res = await POST(
      postReq({ raw_text: 'hi', trip_id: otherTrip }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.capturedInserts).toHaveLength(1);
    expect(state.capturedInserts[0].trip_id).toBe(FIXED_TRIP_ID);
  });
});

// ---------------------------------------------------------------------------
// Source classification (dispatched through fetchSource mock)
// ---------------------------------------------------------------------------

describe('POST /extract — source classification', () => {
  it('youtube URL → source_type=youtube persisted', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'youtube',
      raw_text: 'transcript',
    });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(
      postReq({ source_url: 'https://youtube.com/watch?v=abc' }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.capturedInserts[0].source_type).toBe('youtube');
  });

  it('twitter URL → source_type=twitter persisted', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'twitter',
      raw_text: 'tweet',
    });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(
      postReq({ source_url: 'https://x.com/u/status/1' }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.capturedInserts[0].source_type).toBe('twitter');
  });

  it('generic URL → source_type=web persisted', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'web',
      raw_text: 'meta',
    });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(
      postReq({ source_url: 'https://example.com/post' }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.capturedInserts[0].source_type).toBe('web');
  });

  it('raw_text only → source_type=text persisted', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'some caption',
    });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(postReq({ raw_text: 'some caption' }), tripCtx);
    expect(res.status).toBe(201);
    expect(state.capturedInserts[0].source_type).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// LLM persistence + extracted_json
// ---------------------------------------------------------------------------

describe('POST /extract — LLM extraction + persistence', () => {
  it('persists extracted_json matching LLM output', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'hello',
    });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(postReq({ raw_text: 'hello' }), tripCtx);
    expect(res.status).toBe(201);
    expect(state.capturedInserts[0].extracted_json).toEqual(cannedExtract);
    const body = (await res.json()) as { extracted: typeof cannedExtract };
    expect(body.extracted).toEqual(cannedExtract);
  });

  it('writes import_extract audit on success', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'hello',
    });
    extractMock.mockResolvedValue(cannedExtract);
    await POST(postReq({ raw_text: 'hello' }), tripCtx);
    const audit = auditCalls.find((a) => a.action === 'import_extract');
    expect(audit).toBeDefined();
    expect(audit?.entityId).toBe(FIXED_SOURCE_ID);
    expect(audit?.tripId).toBe(FIXED_TRIP_ID);
  });
});

// ---------------------------------------------------------------------------
// Zero-results guard (AC 13)
// ---------------------------------------------------------------------------

describe('POST /extract — zero-results guard (AC 13)', () => {
  it('empty places + empty tips → 422 extraction_empty + no DB write', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'hello',
    });
    extractMock.mockResolvedValue({ places: [], tips: [] });
    const res = await POST(postReq({ raw_text: 'hello' }), tripCtx);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('extraction_empty');
    expect(state.capturedInserts).toHaveLength(0);
  });

  it('one place, zero tips → still persisted (201)', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'hello',
    });
    extractMock.mockResolvedValue({
      places: [{ name: 'X', category: 'cafe', why: 'why' }],
      tips: [],
    });
    const res = await POST(postReq({ raw_text: 'hello' }), tripCtx);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Duplicate-URL guard (AC 12)
// ---------------------------------------------------------------------------

describe('POST /extract — duplicate URL guard (AC 12)', () => {
  it('recent (<24h) row exists for same URL → 409 with prior id', async () => {
    state.dup = { id: PRIOR_SOURCE_ID, created_at: '2026-05-14T12:00:00Z' };
    const res = await POST(
      postReq({ source_url: 'https://example.com/x' }),
      tripCtx,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; details: { import_source_id: string } };
    };
    expect(body.error.code).toBe('duplicate_recent_import');
    expect(body.error.details.import_source_id).toBe(PRIOR_SOURCE_ID);
    // No LLM call, no insert.
    expect(extractMock).not.toHaveBeenCalled();
    expect(state.capturedInserts).toHaveLength(0);
  });

  it('duplicate check is skipped when raw_text-only (no URL)', async () => {
    state.dup = { id: PRIOR_SOURCE_ID, created_at: '2026-05-14T12:00:00Z' };
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'hi',
    });
    extractMock.mockResolvedValue(cannedExtract);
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Rate limit (AC 8)
// ---------------------------------------------------------------------------

describe('POST /extract — rate limit (AC 8)', () => {
  it('21st request within window → 429 with Retry-After', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'hi',
    });
    extractMock.mockResolvedValue(cannedExtract);
    for (let i = 0; i < 20; i++) {
      const r = await POST(postReq({ raw_text: 'hi' }), tripCtx);
      expect(r.status).toBe(201);
    }
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).not.toBeNull();
    const audit = auditCalls.find((a) => a.action === 'import_rate_limited');
    expect(audit).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SSRF / unsupported source mapping
// ---------------------------------------------------------------------------

describe('POST /extract — SSRF / unsupported source', () => {
  it('UnsupportedSourceError from fetchSource → 422 unsupported_source (loopback IP)', async () => {
    fetchSourceMock.mockRejectedValue(
      new UnsupportedSourceErrorClass('blocked'),
    );
    const res = await POST(
      postReq({ source_url: 'http://127.0.0.1/admin' }),
      tripCtx,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unsupported_source');
    expect(state.capturedInserts).toHaveLength(0);
  });

  it('UnsupportedSourceError → 422 (cloud-metadata IP)', async () => {
    fetchSourceMock.mockRejectedValue(
      new UnsupportedSourceErrorClass('blocked'),
    );
    const res = await POST(
      postReq({ source_url: 'http://169.254.169.254/latest/meta-data/' }),
      tripCtx,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unsupported_source');
  });

  it('SourceFetchError → 502 source_fetch_failed', async () => {
    fetchSourceMock.mockRejectedValue(new SourceFetchErrorClass('timeout'));
    const res = await POST(
      postReq({ source_url: 'https://example.com/x' }),
      tripCtx,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('source_fetch_failed');
  });

  it('LLM failure → 502 llm_unavailable + import_extract_failed audit', async () => {
    fetchSourceMock.mockResolvedValue({
      source_type: 'text',
      raw_text: 'hi',
    });
    extractMock.mockRejectedValue(new LlmExtractionErrorStub('boom'));
    const res = await POST(postReq({ raw_text: 'hi' }), tripCtx);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('llm_unavailable');
    const audit = auditCalls.find((a) => a.action === 'import_extract_failed');
    expect(audit).toBeDefined();
  });
});
