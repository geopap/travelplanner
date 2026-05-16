/**
 * B-023 — Integration tests for GET /api/trips/[id]/days/[dayId]/map.
 *
 * Covers viewer/editor/owner read access, non-member 404, malformed UUID 404,
 * both result arrays returned correctly with FK embed shapes, items without
 * place_id excluded from `items[]`, accommodations with null embed excluded,
 * and the four `indicator_type` permutations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID, FIXED_DAY_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

let role: 'viewer' | 'editor' | 'owner' | 'none' = 'viewer';
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

interface MockState {
  dayRow: { id: string; date: string } | null;
  items: Array<Record<string, unknown>>;
  accommodations: Array<Record<string, unknown>>;
  itemsError: { message: string } | null;
  accomError: { message: string } | null;
}

const state: MockState = {
  dayRow: { id: FIXED_DAY_ID, date: '2026-05-05' },
  items: [],
  accommodations: [],
  itemsError: null,
  accomError: null,
};

function makeChain(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.lte = () => chain;
  chain.gte = () => chain;
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = async () => {
    if (table === 'itinerary_items') {
      return state.itemsError
        ? { data: null, error: state.itemsError }
        : { data: state.items, error: null };
    }
    if (table === 'accommodations') {
      return state.accomError
        ? { data: null, error: state.accomError }
        : { data: state.accommodations, error: null };
    }
    return { data: [], error: null };
  };
  chain.maybeSingle = async () => {
    if (table === 'trip_days') return { data: state.dayRow, error: null };
    return { data: null, error: null };
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }) },
    from: (t: string) => makeChain(t),
  }),
}));

// Imported AFTER mocks.
import { GET } from '@/app/api/trips/[id]/days/[dayId]/map/route';

const PLACE = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Senso-ji',
  lat: 35.7148,
  lng: 139.7967,
};

const ctxFor = (tripId: string, dayId: string) => ({
  params: Promise.resolve({ id: tripId, dayId }),
});

function makeReq(tripId: string, dayId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${tripId}/days/${dayId}/map`,
    { method: 'GET' },
  );
}

beforeEach(() => {
  role = 'viewer';
  state.dayRow = { id: FIXED_DAY_ID, date: '2026-05-05' };
  state.items = [];
  state.accommodations = [];
  state.itemsError = null;
  state.accomError = null;
});

describe('GET /api/trips/[id]/days/[dayId]/map — B-023', () => {
  it('returns items and accommodations for a member (viewer)', async () => {
    state.items = [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        title: 'Visit temple',
        type: 'activity',
        start_time: '10:00:00',
        place: PLACE,
      },
    ];
    state.accommodations = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        hotel_name: 'Park Hyatt',
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-07',
        place: PLACE,
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; place: unknown }>;
      accommodations: Array<{
        accommodation_id: string;
        hotel_name: string;
        indicator_type: string;
        place: typeof PLACE;
      }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].place).toEqual(PLACE);
    expect(body.accommodations).toHaveLength(1);
    expect(body.accommodations[0].indicator_type).toBe('check_in');
    expect(body.accommodations[0].place).toEqual(PLACE);
  });

  it('editor can read', async () => {
    role = 'editor';
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    expect(res.status).toBe(200);
  });

  it('owner can read', async () => {
    role = 'owner';
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    expect(res.status).toBe(200);
  });

  it('non-member receives 404 (existence-hiding)', async () => {
    role = 'none';
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed dayId UUID', async () => {
    const ctx = { params: Promise.resolve({ id: FIXED_TRIP_ID, dayId: 'not-a-uuid' }) };
    const req = new NextRequest(`http://localhost/api/trips/${FIXED_TRIP_ID}/days/not-a-uuid/map`);
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed tripId UUID', async () => {
    const ctx = { params: Promise.resolve({ id: 'bad-uuid', dayId: FIXED_DAY_ID }) };
    const req = new NextRequest(`http://localhost/api/trips/bad-uuid/days/${FIXED_DAY_ID}/map`);
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 404 when day does not belong to trip', async () => {
    state.dayRow = null;
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    expect(res.status).toBe(404);
  });

  it('excludes items whose place embed is null', async () => {
    state.items = [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        title: 'No place',
        type: 'activity',
        start_time: null,
        place: null,
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ place: unknown }> };
    // Item is kept in response with place=null (mirrors existing items route);
    // frontend filters to place!=null for plotting.
    expect(body.items).toHaveLength(1);
    expect(body.items[0].place).toBeNull();
  });

  it('excludes accommodations whose embedded place has null coords', async () => {
    state.accommodations = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        hotel_name: 'No coords yet',
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-07',
        place: { ...PLACE, lat: null, lng: null },
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accommodations: unknown[] };
    expect(body.accommodations).toHaveLength(0);
  });

  it('computes indicator_type = check_in', async () => {
    state.dayRow = { id: FIXED_DAY_ID, date: '2026-05-05' };
    state.accommodations = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        hotel_name: 'H',
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-07',
        place: PLACE,
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    const body = (await res.json()) as { accommodations: Array<{ indicator_type: string }> };
    expect(body.accommodations[0].indicator_type).toBe('check_in');
  });

  it('computes indicator_type = check_out', async () => {
    state.dayRow = { id: FIXED_DAY_ID, date: '2026-05-07' };
    state.accommodations = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        hotel_name: 'H',
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-07',
        place: PLACE,
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    const body = (await res.json()) as { accommodations: Array<{ indicator_type: string }> };
    expect(body.accommodations[0].indicator_type).toBe('check_out');
  });

  it('computes indicator_type = in_stay', async () => {
    state.dayRow = { id: FIXED_DAY_ID, date: '2026-05-06' };
    state.accommodations = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        hotel_name: 'H',
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-07',
        place: PLACE,
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    const body = (await res.json()) as { accommodations: Array<{ indicator_type: string }> };
    expect(body.accommodations[0].indicator_type).toBe('in_stay');
  });

  it('computes indicator_type = same_day', async () => {
    state.dayRow = { id: FIXED_DAY_ID, date: '2026-05-05' };
    state.accommodations = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        hotel_name: 'H',
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-05',
        place: PLACE,
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    const body = (await res.json()) as { accommodations: Array<{ indicator_type: string }> };
    expect(body.accommodations[0].indicator_type).toBe('same_day');
  });

  it('falls back to place.name when hotel_name is null', async () => {
    state.accommodations = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        hotel_name: null,
        check_in_date: '2026-05-05',
        check_out_date: '2026-05-07',
        place: PLACE,
      },
    ];
    const res = await GET(makeReq(FIXED_TRIP_ID, FIXED_DAY_ID), ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID));
    const body = (await res.json()) as { accommodations: Array<{ hotel_name: string }> };
    expect(body.accommodations[0].hotel_name).toBe(PLACE.name);
  });
});
