/**
 * B-015 — items endpoint integration tests for the `place` embed and the
 * `place_id` create/patch surface.
 *
 * Why a separate file (vs. extending items.test.ts):
 * - This suite exercises a different Supabase chain (list returns rows with an
 *   embedded `place`, item lookup returns existing-row metadata for PATCH) so
 *   keeping it isolated avoids destabilising the existing items tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID, FIXED_DAY_ID, FIXED_ITEM_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

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

const PLACE_ROW = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Senso-ji Temple',
  lat: 35.7148,
  lng: 139.7967,
};

// Rows the GET list returns. Mutated per-test.
let listRows: Array<Record<string, unknown>> = [];

// Captured PATCH payload for assertions.
let capturedUpdate: Record<string, unknown> | null = null;

// Mocked existing row used by the PATCH route's pre-flight lookup.
const existingRow = {
  id: FIXED_ITEM_ID,
  type: 'activity',
  trip_id: FIXED_TRIP_ID,
};

function fullRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXED_ITEM_ID,
    trip_id: FIXED_TRIP_ID,
    day_id: FIXED_DAY_ID,
    type: 'activity',
    title: 'Visit temple',
    start_time: null,
    end_time: null,
    external_url: null,
    cost: null,
    currency: null,
    notes: null,
    place_id: null,
    created_by: FIXED_USER_ID,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = async () => {
    if (table === 'itinerary_items') {
      return { data: listRows, error: null, count: listRows.length };
    }
    return { data: [], error: null, count: 0 };
  };
  chain.maybeSingle = async () => {
    if (table === 'trip_days') {
      return { data: { id: FIXED_DAY_ID }, error: null };
    }
    if (table === 'itinerary_items') {
      // PATCH preflight lookup of the existing row.
      return { data: existingRow, error: null };
    }
    return { data: null, error: null };
  };
  chain.insert = (payload: Record<string, unknown>) => ({
    select: () => ({
      single: async () => ({
        data: fullRow(payload),
        error: null,
      }),
    }),
  });
  chain.update = (payload: Record<string, unknown>) => {
    capturedUpdate = payload;
    return {
      eq: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: fullRow({ ...payload }),
              error: null,
            }),
          }),
        }),
      }),
    };
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }),
      getSession: async () => ({
        data: { session: { user: { id: FIXED_USER_ID }, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
        error: null,
      }),
      refreshSession: async () => ({
        data: { session: { user: { id: FIXED_USER_ID }, expires_at: Math.floor(Date.now() / 1000) + 3600 } },
        error: null,
      }),
    },
    from: (t: string) => makeChain(t),
  }),
}));

// Imported AFTER mocks so module-level captures resolve correctly.
import { GET, POST } from '@/app/api/trips/[id]/items/route';
import { PATCH } from '@/app/api/trips/[id]/items/[itemId]/route';

const ctx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };
const itemCtx = {
  params: Promise.resolve({ id: FIXED_TRIP_ID, itemId: FIXED_ITEM_ID }),
};

beforeEach(() => {
  role = 'editor';
  listRows = [];
  capturedUpdate = null;
});

describe('GET /api/trips/[id]/items — place embed (B-015)', () => {
  it('returns items with embedded place when coords present', async () => {
    listRows = [fullRow({ place_id: PLACE_ROW.id, place: PLACE_ROW })];
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ place: typeof PLACE_ROW | null }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].place).toEqual(PLACE_ROW);
  });

  it('returns place: null for items without a linked place', async () => {
    listRows = [fullRow({ place_id: null, place: null })];
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ place: unknown }> };
    expect(body.items[0].place).toBeNull();
  });

  it('normalises place with null coords to place: null', async () => {
    // Defence-in-depth: an authenticated place row that hasn't been geocoded
    // yet must not break the map — the route should null it out.
    const partialPlace = { ...PLACE_ROW, lat: null, lng: null };
    listRows = [fullRow({ place_id: PLACE_ROW.id, place: partialPlace })];
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ place: unknown }> };
    expect(body.items[0].place).toBeNull();
  });

  it('viewer can read items + embed', async () => {
    role = 'viewer';
    listRows = [fullRow({ place_id: PLACE_ROW.id, place: PLACE_ROW })];
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
  });

  it('non-member receives 404 (existence-hiding)', async () => {
    role = 'none';
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items`,
      { method: 'GET' },
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/trips/[id]/items — place_id (B-015)', () => {
  function mkPost(body: Record<string, unknown>): NextRequest {
    return new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  it('accepts and persists place_id on create', async () => {
    const body = {
      day_id: FIXED_DAY_ID,
      type: 'activity',
      title: 'Visit temple',
      place_id: PLACE_ROW.id,
    };
    const res = await POST(mkPost(body), ctx);
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { item: { place_id: string | null } };
    expect(payload.item.place_id).toBe(PLACE_ROW.id);
  });

  it('rejects invalid place_id (non-UUID) with 400', async () => {
    const body = {
      day_id: FIXED_DAY_ID,
      type: 'activity',
      title: 'Visit temple',
      place_id: 'not-a-uuid',
    };
    const res = await POST(mkPost(body), ctx);
    expect(res.status).toBe(400);
  });

  it('accepts null place_id (no link)', async () => {
    const body = {
      day_id: FIXED_DAY_ID,
      type: 'activity',
      title: 'Visit temple',
      place_id: null,
    };
    const res = await POST(mkPost(body), ctx);
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/trips/[id]/items/[itemId] — place_id (B-015)', () => {
  function mkPatch(body: Record<string, unknown>): NextRequest {
    return new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/items/${FIXED_ITEM_ID}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  it('attaches a place via PATCH', async () => {
    const res = await PATCH(mkPatch({ place_id: PLACE_ROW.id }), itemCtx);
    expect(res.status).toBe(200);
    expect(capturedUpdate?.place_id).toBe(PLACE_ROW.id);
  });

  it('detaches a place via PATCH place_id: null', async () => {
    const res = await PATCH(mkPatch({ place_id: null }), itemCtx);
    expect(res.status).toBe(200);
    // Must explicitly write `null` (not omit) so the FK is cleared.
    expect(capturedUpdate).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(capturedUpdate, 'place_id')).toBe(
      true,
    );
    expect(capturedUpdate?.place_id).toBeNull();
  });

  it('rejects invalid place_id (non-UUID) with 400', async () => {
    const res = await PATCH(mkPatch({ place_id: 'not-a-uuid' }), itemCtx);
    expect(res.status).toBe(400);
  });

  it('viewer cannot PATCH place_id (403)', async () => {
    role = 'viewer';
    const res = await PATCH(mkPatch({ place_id: PLACE_ROW.id }), itemCtx);
    expect(res.status).toBe(403);
  });
});
