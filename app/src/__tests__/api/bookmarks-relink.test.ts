/**
 * B-026 — API tests for POST /api/trips/[id]/bookmarks/relink.
 * Mocks Supabase server client, trip-access guard, rate-limit, and the
 * place resolver. Mirrors the mock pattern in api/transportation.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

// Per-test access role
let role: 'viewer' | 'editor' | 'owner' | 'none' = 'editor';
vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async (
    _sb: unknown,
    _trip: string,
    _user: string,
    required: 'viewer' | 'editor' | 'owner',
  ) => {
    if (role === 'none') return { ok: false, reason: 'not_found' };
    const rank: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[required]) return { ok: false, reason: 'forbidden' };
    return { ok: true, role };
  },
}));

// Per-test rate-limit gate
let rateLimitOk = true;
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () =>
    rateLimitOk ? { ok: true } : { ok: false, retryAfterMs: 30_000 },
}));

// Place resolver result (place_id_resolved, or simulate failure)
type ResolveResult =
  | { ok: true; placeId: string }
  | { ok: false; reason: 'not_found' | 'unavailable' };
let resolveResult: ResolveResult = {
  ok: true,
  placeId: '00000000-0000-4000-8000-000000000200',
};
vi.mock('@/lib/places/resolve', () => ({
  resolveOrFetchPlace: async () => resolveResult,
}));

// Authenticated session toggle
let sessionUser: { id: string } | null = { id: FIXED_USER_ID };

// RPC result
let rpcResult: { bookmarks: number; itinerary_items: number } = {
  bookmarks: 2,
  itinerary_items: 1,
};
let rpcError: { message: string } | null = null;
const rpcCalls: Array<{ name: string; args: unknown }> = [];

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: sessionUser } }),
      getSession: async () => ({
        data: { session: { user: sessionUser, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
        error: null,
      }),
      refreshSession: async () => ({
        data: { session: { user: sessionUser, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (rpcError) return { data: null, error: rpcError };
      return { data: rpcResult, error: null };
    },
  }),
}));

import { POST as RELINK_POST } from '@/app/api/trips/[id]/bookmarks/relink/route';

const tripCtx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };
const VALID_UUID = '00000000-0000-4000-8000-000000000010';
const VALID_GPID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

function mkReq(body: unknown, asString?: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/bookmarks/relink`,
    {
      method: 'POST',
      body: asString ?? JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

beforeEach(() => {
  role = 'editor';
  rateLimitOk = true;
  sessionUser = { id: FIXED_USER_ID };
  resolveResult = {
    ok: true,
    placeId: '00000000-0000-4000-8000-000000000200',
  };
  rpcResult = { bookmarks: 2, itinerary_items: 1 };
  rpcError = null;
  rpcCalls.length = 0;
});

describe('POST /api/trips/[id]/bookmarks/relink (B-026)', () => {
  it('401 when no session', async () => {
    sessionUser = null;
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(401);
  });

  it('404 for non-member', async () => {
    role = 'none';
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(404);
  });

  it('403 for viewer', async () => {
    role = 'viewer';
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(403);
  });

  it('400 for invalid JSON body', async () => {
    const res = await RELINK_POST(mkReq(null, '{not json'), tripCtx);
    expect(res.status).toBe(400);
  });

  it('400 for body failing schema (missing fields)', async () => {
    const res = await RELINK_POST(mkReq({}), tripCtx);
    expect(res.status).toBe(400);
  });

  it('400 for invalid to_google_place_id (illegal char)', async () => {
    const res = await RELINK_POST(
      mkReq({
        from_place_id: VALID_UUID,
        to_google_place_id: 'bad place id with spaces',
      }),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });

  it('429 when rate-limited', async () => {
    rateLimitOk = false;
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(429);
  });

  it('200 happy path returns { updated, new_place_id }', async () => {
    rpcResult = { bookmarks: 2, itinerary_items: 1 };
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      updated: { bookmarks: number; itinerary_items: number };
      new_place_id: string;
    };
    expect(body.updated).toEqual({ bookmarks: 2, itinerary_items: 1 });
    expect(body.new_place_id).toBe(
      '00000000-0000-4000-8000-000000000200',
    );
    expect(rpcCalls.find((c) => c.name === 'relink_place')).toBeDefined();
  });

  it('404 with code_detail from_place_not_in_trip when both counts are zero', async () => {
    rpcResult = { bookmarks: 0, itinerary_items: 0 };
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; details?: { code_detail?: string } };
    };
    expect(body.error.details?.code_detail).toBe('from_place_not_in_trip');
  });

  it('404 when resolveOrFetchPlace returns not_found', async () => {
    resolveResult = { ok: false, reason: 'not_found' };
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(404);
  });

  it('502 when place resolver is unavailable', async () => {
    resolveResult = { ok: false, reason: 'unavailable' };
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(502);
  });

  it('500 when RPC errors', async () => {
    rpcError = { message: 'boom' };
    const res = await RELINK_POST(
      mkReq({ from_place_id: VALID_UUID, to_google_place_id: VALID_GPID }),
      tripCtx,
    );
    expect(res.status).toBe(500);
  });
});
