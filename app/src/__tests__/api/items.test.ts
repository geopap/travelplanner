import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID, FIXED_DAY_ID, makeItemInput } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

let role: 'viewer' | 'editor' | 'owner' | 'none' = 'editor';
vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async (_sb: unknown, _trip: string, _user: string, required: string) => {
    if (role === 'none') return { ok: false, reason: 'not_found' };
    const rank: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[required]) return { ok: false, reason: 'forbidden' };
    return { ok: true, role };
  },
}));

// State for inserts
interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}
const captured: CapturedInsert[] = [];
let dayBelongsToTrip = true;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = async () => ({ data: [], error: null, count: 0 });
  chain.maybeSingle = async () => {
    if (table === 'trip_days') {
      return dayBelongsToTrip
        ? { data: { id: FIXED_DAY_ID }, error: null }
        : { data: null, error: null };
    }
    return { data: null, error: null };
  };
  chain.insert = (payload: Record<string, unknown>) => {
    captured.push({ table, payload });
    return {
      select: () => ({
        single: async () => ({
          // Return a fully-populated row that round-trips through
          // `ItineraryItemRowSchema` (uuid + nullable timestamp shape).
          data: {
            id: '11111111-1111-4111-8111-111111111111',
            trip_id: FIXED_TRIP_ID,
            day_id: FIXED_DAY_ID,
            type: 'activity',
            title: 'mock',
            start_time: null,
            end_time: null,
            external_url: null,
            cost: null,
            currency: null,
            notes: null,
            created_by: FIXED_USER_ID,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            ...payload,
          },
          error: null,
        }),
      }),
    };
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }) },
    from: (t: string) => makeChain(t),
  }),
}));

import { GET, POST } from '@/app/api/trips/[id]/items/route';

const ctx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };

beforeEach(() => {
  role = 'editor';
  captured.length = 0;
  dayBelongsToTrip = true;
});

describe('GET /api/trips/[id]/items', () => {
  it('accepts day_id, page, limit query params', async () => {
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items?day_id=${FIXED_DAY_ID}&page=1&limit=50`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
  });

  it('rejects invalid day_id with 400', async () => {
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items?day_id=not-a-uuid`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it('404 when day_id does not belong to this trip', async () => {
    dayBelongsToTrip = false;
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items?day_id=${FIXED_DAY_ID}`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('rejects limit > 200', async () => {
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items?limit=500`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/trips/[id]/items', () => {
  function mkPost(body: Record<string, unknown>): NextRequest {
    return new NextRequest(`http://localhost/api/trips/${FIXED_TRIP_ID}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('creates item with trip_id taken from URL (ignores body trip_id) — regression', async () => {
    const bogusTrip = '99999999-9999-4999-8999-999999999999';
    const res = await POST(mkPost({ ...makeItemInput(), trip_id: bogusTrip }), ctx);
    expect(res.status).toBe(201);
    const insert = captured.find((c) => c.table === 'itinerary_items');
    expect(insert).toBeDefined();
    // Must use URL trip_id, not the bogus one from the body.
    expect(insert?.payload.trip_id).toBe(FIXED_TRIP_ID);
  });

  it('sets created_by from auth.user.id server-side', async () => {
    await POST(mkPost(makeItemInput()), ctx);
    const insert = captured.find((c) => c.table === 'itinerary_items');
    expect(insert?.payload.created_by).toBe(FIXED_USER_ID);
  });

  it('400 when day_id missing', async () => {
    const input = makeItemInput();
    delete (input as Record<string, unknown>).day_id;
    const res = await POST(mkPost(input), ctx);
    expect(res.status).toBe(400);
  });

  it('400 when target day does not belong to this trip', async () => {
    dayBelongsToTrip = false;
    const res = await POST(mkPost(makeItemInput()), ctx);
    expect(res.status).toBe(400);
  });

  it('403 when user is viewer', async () => {
    role = 'viewer';
    const res = await POST(mkPost(makeItemInput()), ctx);
    expect(res.status).toBe(403);
  });

  it('404 when user is not a member', async () => {
    role = 'none';
    const res = await POST(mkPost(makeItemInput()), ctx);
    expect(res.status).toBe(404);
  });

  it('400 on invalid JSON body', async () => {
    const req = new NextRequest(`http://localhost/api/trips/${FIXED_TRIP_ID}/items`, {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });
});
