import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (params: Record<string, unknown>) => {
    auditCalls.push(params);
  },
}));

let authedUserId: string | null = FIXED_USER_ID;
// Cache rows returned from the mocked supabase `.from('places')` chain.
// Tests mutate this array per case to simulate cache hit / miss.
let cacheRows: Array<Record<string, unknown>> = [];
let cacheError: { message: string } | null = null;
const cacheChainCalls: Array<{ ilike?: string; gte?: string; limit?: number }> =
  [];

function mockSupabase() {
  return {
    from(table: string) {
      if (table !== 'places') {
        throw new Error(`unexpected table: ${table}`);
      }
      const state: { ilike?: string; gte?: string; limit?: number } = {};
      const builder = {
        select() {
          return builder;
        },
        ilike(_col: string, val: string) {
          state.ilike = val;
          return builder;
        },
        gte(_col: string, val: string) {
          state.gte = val;
          return builder;
        },
        limit(n: number) {
          state.limit = n;
          return builder;
        },
        returns() {
          return builder;
        },
        then(
          resolve: (v: {
            data: Array<Record<string, unknown>> | null;
            error: { message: string } | null;
          }) => unknown,
        ) {
          cacheChainCalls.push(state);
          return Promise.resolve({
            data: cacheError ? null : cacheRows,
            error: cacheError,
          }).then(resolve);
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  requireAuth: async () =>
    authedUserId
      ? { user: { id: authedUserId }, supabase: mockSupabase() }
      : null,
}));

// Mock the Google places module so we control searchPlaces behavior at the
// route level (the lib itself is covered separately).
const searchPlacesMock = vi.fn();
vi.mock('@/lib/google/places', () => ({
  searchPlaces: (q: string) => searchPlacesMock(q),
}));

import { GET } from '@/app/api/places/search/route';
import { resetKey } from '@/lib/rate-limit';

function mkReq(q: string): NextRequest {
  const url = `http://localhost/api/places/search?q=${encodeURIComponent(q)}`;
  return new NextRequest(url, { method: 'GET' });
}
function mkReqRaw(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/places/search${qs}`, {
    method: 'GET',
  });
}

beforeEach(() => {
  authedUserId = FIXED_USER_ID;
  auditCalls.length = 0;
  searchPlacesMock.mockReset();
  // Default: empty success.
  searchPlacesMock.mockResolvedValue([]);
  // Default cache state: empty (forces fall-through to Google).
  cacheRows = [];
  cacheError = null;
  cacheChainCalls.length = 0;
  resetKey(`places:search:user:${FIXED_USER_ID}`);
});

afterEach(() => {
  resetKey(`places:search:user:${FIXED_USER_ID}`);
});

describe('GET /api/places/search — validation', () => {
  it('400 invalid_query when q is missing', async () => {
    const res = await GET(mkReqRaw(''));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_query');
  });

  it('400 invalid_query when q is empty string', async () => {
    const res = await GET(mkReq(''));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_query');
  });

  it('400 invalid_query when q is 1 char', async () => {
    const res = await GET(mkReq('a'));
    expect(res.status).toBe(400);
    expect(searchPlacesMock).not.toHaveBeenCalled();
  });

  it('400 invalid_query when q exceeds max (>100 chars)', async () => {
    const big = 'a'.repeat(101);
    const res = await GET(mkReq(big));
    expect(res.status).toBe(400);
    expect(searchPlacesMock).not.toHaveBeenCalled();
  });

  it('400 invalid_query when q is only whitespace', async () => {
    const res = await GET(mkReq('   '));
    expect(res.status).toBe(400);
  });

  it('strips control characters before validation', async () => {
    searchPlacesMock.mockResolvedValueOnce([]);
    const res = await GET(mkReq('to\u0007kyo'));
    expect(res.status).toBe(200);
    expect(searchPlacesMock).toHaveBeenCalledWith('tokyo');
  });

  it('accepts valid 2-char query', async () => {
    searchPlacesMock.mockResolvedValueOnce([]);
    const res = await GET(mkReq('ab'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/places/search — auth', () => {
  it('401 unauthorized when no session', async () => {
    authedUserId = null;
    const res = await GET(mkReq('tokyo'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(searchPlacesMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/places/search — rate limit', () => {
  it('429 rate_limit_exceeded on the 31st call within window', async () => {
    searchPlacesMock.mockResolvedValue([]);
    let last = 0;
    for (let i = 0; i < 30; i++) {
      const r = await GET(mkReq('tokyo'));
      last = r.status;
    }
    expect(last).toBe(200);
    const blocked = await GET(mkReq('tokyo'));
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: { code: string; details: { retry_after: number } };
    };
    expect(body.error.code).toBe('rate_limit_exceeded');
    expect(body.error.details.retry_after).toBeGreaterThan(0);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
    // Audit must record the rate-limit event.
    const rl = auditCalls.find((c) => c.action === 'places_rate_limited');
    expect(rl).toBeDefined();
  });
});

describe('GET /api/places/search — Google failure', () => {
  it('502 places_unavailable when searchPlaces throws', async () => {
    searchPlacesMock.mockRejectedValueOnce(new Error('places_http_502'));
    const res = await GET(mkReq('tokyo'));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('places_unavailable');
  });
});

describe('GET /api/places/search — success shape & audit', () => {
  it('returns canonical PlaceSearchResult rows with nullable fields preserved', async () => {
    searchPlacesMock.mockResolvedValueOnce([
      {
        google_place_id: 'g1',
        name: 'Tokyo Tower',
        formatted_address: '4 Chome-2-8 Shibakoen, Tokyo',
        lat: 35.6586,
        lng: 139.7454,
        category: 'sight',
      },
      {
        google_place_id: 'g2',
        name: 'No Address Place',
        formatted_address: null,
        lat: null,
        lng: null,
        category: 'other',
      },
    ]);

    const res = await GET(mkReq('tokyo'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<Record<string, unknown>>;
    };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toMatchObject({
      google_place_id: 'g1',
      name: 'Tokyo Tower',
      formatted_address: '4 Chome-2-8 Shibakoen, Tokyo',
      category: 'sight',
    });
    // Nulls preserved on the wire.
    expect(body.results[1].formatted_address).toBeNull();
    expect(body.results[1].lat).toBeNull();
    expect(body.results[1].lng).toBeNull();
  });

  it('emits places_searched audit with non-PII metadata only', async () => {
    searchPlacesMock.mockResolvedValueOnce([
      {
        google_place_id: 'g1',
        name: 'X',
        formatted_address: null,
        lat: null,
        lng: null,
        category: 'other',
      },
    ]);
    await GET(mkReq('private query'));
    const evt = auditCalls.find((c) => c.action === 'places_searched');
    expect(evt).toBeDefined();
    const meta = evt!.metadata as Record<string, unknown>;
    expect(meta).toHaveProperty('query_length');
    expect(meta).toHaveProperty('result_count', 1);
    // Critical: raw query MUST NOT appear in metadata.
    expect(JSON.stringify(meta)).not.toMatch(/private query/);
    expect(meta).not.toHaveProperty('q');
    expect(meta).not.toHaveProperty('query');
  });
});

describe('GET /api/places/search — cache-first read (AC #3)', () => {
  it('returns cached rows without calling Google when cache has fresh hits', async () => {
    cacheRows = [
      {
        google_place_id: 'cache1',
        name: 'Tokyo Skytree',
        formatted_address: '1 Chome-1-2 Oshiage, Sumida',
        lat: 35.7101,
        lng: 139.8107,
        category: 'sight',
      },
      {
        google_place_id: 'cache2',
        name: 'Tokyo Station',
        formatted_address: null,
        lat: null,
        lng: null,
        category: 'transport_hub',
      },
    ];

    const res = await GET(mkReq('tokyo'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<Record<string, unknown>>;
      source: string;
    };
    expect(body.source).toBe('cache');
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toMatchObject({
      google_place_id: 'cache1',
      name: 'Tokyo Skytree',
      category: 'sight',
    });
    // Google fetch MUST NOT be called on cache hit.
    expect(searchPlacesMock).not.toHaveBeenCalled();
    // Cache chain was queried with ILIKE %tokyo% and a TTL gte cutoff.
    expect(cacheChainCalls).toHaveLength(1);
    expect(cacheChainCalls[0].ilike).toBe('%tokyo%');
    expect(cacheChainCalls[0].gte).toBeDefined();
    expect(cacheChainCalls[0].limit).toBeGreaterThan(0);
    // Audit recorded as cache hit, not a regular search.
    const evt = auditCalls.find(
      (c) => c.action === 'places_search_cache_hit',
    );
    expect(evt).toBeDefined();
    const meta = evt!.metadata as Record<string, unknown>;
    expect(meta).toHaveProperty('query_length', 5);
    expect(meta).toHaveProperty('result_count', 2);
    expect(meta).not.toHaveProperty('q');
    expect(
      auditCalls.find((c) => c.action === 'places_searched'),
    ).toBeUndefined();
  });

  it('falls through to Google when cache is empty', async () => {
    cacheRows = [];
    searchPlacesMock.mockResolvedValueOnce([
      {
        google_place_id: 'g1',
        name: 'Tokyo Tower',
        formatted_address: null,
        lat: null,
        lng: null,
        category: 'sight',
      },
    ]);
    const res = await GET(mkReq('tokyo'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: unknown[];
      source: string;
    };
    expect(body.source).toBe('google');
    expect(body.results).toHaveLength(1);
    expect(searchPlacesMock).toHaveBeenCalledWith('tokyo');
    expect(
      auditCalls.find((c) => c.action === 'places_searched'),
    ).toBeDefined();
    expect(
      auditCalls.find((c) => c.action === 'places_search_cache_hit'),
    ).toBeUndefined();
  });

  it('falls through to Google when cache query errors', async () => {
    cacheError = { message: 'db down' };
    searchPlacesMock.mockResolvedValueOnce([]);
    const res = await GET(mkReq('tokyo'));
    expect(res.status).toBe(200);
    expect(searchPlacesMock).toHaveBeenCalled();
  });
});
