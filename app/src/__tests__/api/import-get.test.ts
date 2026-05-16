/**
 * B-021 — Integration test for GET /api/trips/[id]/import/[sourceId].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
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

const FIXED_SOURCE_ID = '00000000-0000-4000-8000-000000000501';

interface Row {
  id: string;
  trip_id: string;
  source_url: string | null;
  source_type: string;
  status: string;
  created_at: string;
  extracted_json: unknown;
}

const state: {
  authUser: { id: string } | null;
  row: Row | null;
} = {
  authUser: { id: FIXED_USER_ID },
  row: null,
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.authUser } }) },
    from: (table: string) => {
      if (table === 'import_sources') {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.maybeSingle = async () => ({ data: state.row, error: null });
        return chain;
      }
      const noop: Record<string, unknown> = {};
      noop.select = () => noop;
      noop.eq = () => noop;
      noop.maybeSingle = async () => ({ data: null, error: null });
      return noop;
    },
  }),
}));

import { GET } from '@/app/api/trips/[id]/import/[sourceId]/route';

const getCtx = {
  params: Promise.resolve({ id: FIXED_TRIP_ID, sourceId: FIXED_SOURCE_ID }),
};

function getReq(): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/import/${FIXED_SOURCE_ID}`,
    { method: 'GET' },
  );
}

beforeEach(() => {
  accessRole = 'editor';
  state.authUser = { id: FIXED_USER_ID };
  state.row = {
    id: FIXED_SOURCE_ID,
    trip_id: FIXED_TRIP_ID,
    source_url: 'https://youtube.com/watch?v=abc',
    source_type: 'youtube',
    status: 'pending',
    created_at: '2026-05-15T00:00:00Z',
    extracted_json: {
      places: [{ name: 'X', category: 'cafe', why: 'why' }],
      tips: ['t1'],
    },
  };
});

describe('GET /api/trips/[id]/import/[sourceId]', () => {
  it('anon → 401', async () => {
    state.authUser = null;
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(401);
  });

  it('viewer → 403 (editor-gated)', async () => {
    accessRole = 'viewer';
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(403);
  });

  it('non-member → 404', async () => {
    accessRole = 'none';
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(404);
  });

  it('editor → 200 with extracted_json and status', async () => {
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      import_source_id: string;
      status: string;
      extracted: { places: unknown[]; tips: string[] };
    };
    expect(body.import_source_id).toBe(FIXED_SOURCE_ID);
    expect(body.status).toBe('pending');
    expect(body.extracted.places).toHaveLength(1);
    expect(body.extracted.tips).toEqual(['t1']);
  });

  it('owner → 200', async () => {
    accessRole = 'owner';
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(200);
  });

  it('cross-trip leak: row belongs to another trip → 404, no info disclosure', async () => {
    // Simulate: lookup filters by both id AND trip_id; mismatched trip returns null.
    state.row = null;
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('import_source_not_found');
  });

  it('malformed sourceId → 404', async () => {
    const res = await GET(getReq(), {
      params: Promise.resolve({ id: FIXED_TRIP_ID, sourceId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(404);
  });

  it('malformed tripId → 404', async () => {
    const res = await GET(getReq(), {
      params: Promise.resolve({ id: 'not-a-uuid', sourceId: FIXED_SOURCE_ID }),
    });
    expect(res.status).toBe(404);
  });

  it('saved status surfaced as normal field, not 409', async () => {
    state.row = { ...state.row!, status: 'saved' };
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('saved');
  });

  it('invalid persisted source_type → 500 (schema drift guard)', async () => {
    state.row = { ...state.row!, source_type: 'bogus' };
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(500);
  });

  it('invalid persisted extracted_json → 500 (schema drift guard)', async () => {
    state.row = {
      ...state.row!,
      extracted_json: { places: [{ bogus: true }], tips: [] },
    };
    const res = await GET(getReq(), getCtx);
    expect(res.status).toBe(500);
  });
});
