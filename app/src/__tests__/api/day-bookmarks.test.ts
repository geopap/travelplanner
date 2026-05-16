/**
 * B-031 — Integration tests for GET /api/trips/[id]/days/[dayId]/bookmarks.
 *
 * Covers viewer/editor/owner access, non-member 404 (existence-hiding),
 * malformed UUID 404, day-not-on-trip 404, happy-path pairing on both arms,
 * deduplication by bookmark id, empty result when day has no itinerary items,
 * null place_id rows preserved, and stable sort order.
 *
 * The route makes two Supabase round-trips:
 *   1. `itinerary_items` → fetch (source_card_id, place_id) key set.
 *   2. `bookmarks` → fetch rows matching either key, with embedded `places`.
 * Each `from()` call returns a fresh chain so the test mocks both tables
 * independently.
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

interface ItineraryKeyRow {
  source_card_id: string | null;
  place_id: string | null;
}

interface BookmarkRow {
  id: string;
  source_card_id: string | null;
  place_id: string | null;
  category: 'restaurant' | 'sight' | 'museum' | 'shopping' | 'other';
  notes: string | null;
  place:
    | {
        google_place_id: string;
        name: string;
        formatted_address: string | null;
      }
    | null;
}

interface MockState {
  dayRow: { id: string } | null;
  itineraryKeys: ItineraryKeyRow[];
  bookmarks: BookmarkRow[];
  capturedOrClause: string | null;
  bookmarksError: { message: string } | null;
  itineraryError: { message: string } | null;
}

const state: MockState = {
  dayRow: { id: FIXED_DAY_ID },
  itineraryKeys: [],
  bookmarks: [],
  capturedOrClause: null,
  bookmarksError: null,
  itineraryError: null,
};

function makeChain(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.or = (clause: string) => {
    state.capturedOrClause = clause;
    return chain;
  };
  // For trip_days: maybeSingle resolves day lookup.
  chain.maybeSingle = async () => {
    if (table === 'trip_days') return { data: state.dayRow, error: null };
    return { data: null, error: null };
  };
  // For itinerary_items and bookmarks: terminal `.limit()` resolves the rows.
  chain.limit = async () => {
    if (table === 'itinerary_items') {
      return state.itineraryError
        ? { data: null, error: state.itineraryError }
        : { data: state.itineraryKeys, error: null };
    }
    if (table === 'bookmarks') {
      return state.bookmarksError
        ? { data: null, error: state.bookmarksError }
        : { data: state.bookmarks, error: null };
    }
    return { data: [], error: null };
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
import { GET } from '@/app/api/trips/[id]/days/[dayId]/bookmarks/route';

const PLACE_INT_A = '00000000-0000-4000-8000-0000000000aa';
const PLACE_INT_B = '00000000-0000-4000-8000-0000000000bb';
const BOOKMARK_1 = '00000000-0000-4000-8000-0000000000b1';
const BOOKMARK_2 = '00000000-0000-4000-8000-0000000000b2';
const BOOKMARK_3 = '00000000-0000-4000-8000-0000000000b3';

const placeEmbed = (gpid: string, name: string, addr: string | null = null) => ({
  google_place_id: gpid,
  name,
  formatted_address: addr,
});

const ctxFor = (tripId: string, dayId: string) => ({
  params: Promise.resolve({ id: tripId, dayId }),
});

function makeReq(tripId: string, dayId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${tripId}/days/${dayId}/bookmarks`,
    { method: 'GET' },
  );
}

beforeEach(() => {
  role = 'viewer';
  state.dayRow = { id: FIXED_DAY_ID };
  state.itineraryKeys = [];
  state.bookmarks = [];
  state.capturedOrClause = null;
  state.bookmarksError = null;
  state.itineraryError = null;
});

describe('GET /api/trips/[id]/days/[dayId]/bookmarks — B-031', () => {
  it('happy path: returns paired bookmarks for a viewer', async () => {
    state.itineraryKeys = [
      { source_card_id: 'cardA', place_id: PLACE_INT_A },
    ];
    state.bookmarks = [
      {
        id: BOOKMARK_1,
        source_card_id: 'cardA',
        place_id: PLACE_INT_A,
        category: 'restaurant',
        notes: null,
        place: placeEmbed('ChIJ_aaa', 'Sushi Saito', '1-1 Roppongi'),
      },
    ];
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bookmarks: Array<{ id: string; place: { google_place_id: string } | null }>;
    };
    expect(body.bookmarks).toHaveLength(1);
    expect(body.bookmarks[0].id).toBe(BOOKMARK_1);
    expect(body.bookmarks[0].place?.google_place_id).toBe('ChIJ_aaa');
  });

  it('editor can read', async () => {
    role = 'editor';
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(200);
  });

  it('owner can read', async () => {
    role = 'owner';
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(200);
  });

  it('non-member receives 404 (existence-hiding)', async () => {
    role = 'none';
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed dayId UUID', async () => {
    const ctx = {
      params: Promise.resolve({ id: FIXED_TRIP_ID, dayId: 'not-a-uuid' }),
    };
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/days/not-a-uuid/bookmarks`,
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed tripId UUID', async () => {
    const ctx = {
      params: Promise.resolve({ id: 'bad-uuid', dayId: FIXED_DAY_ID }),
    };
    const req = new NextRequest(
      `http://localhost/api/trips/bad-uuid/days/${FIXED_DAY_ID}/bookmarks`,
    );
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns 404 when day does not belong to the trip', async () => {
    state.dayRow = null;
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(404);
  });

  it('returns empty array when day has no itinerary items (short-circuit)', async () => {
    state.itineraryKeys = [];
    state.bookmarks = [
      {
        id: BOOKMARK_1,
        source_card_id: 'cardA',
        place_id: PLACE_INT_A,
        category: 'restaurant',
        notes: null,
        place: placeEmbed('ChIJ_x', 'Should not appear'),
      },
    ];
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookmarks: unknown[] };
    expect(body.bookmarks).toHaveLength(0);
    // The route MUST NOT issue the bookmarks query in this case.
    expect(state.capturedOrClause).toBeNull();
  });

  it('builds an OR clause covering both arms when itinerary keys span both', async () => {
    state.itineraryKeys = [
      { source_card_id: 'cardA', place_id: null },
      { source_card_id: null, place_id: PLACE_INT_B },
    ];
    state.bookmarks = [];
    await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(state.capturedOrClause).toBe(
      `source_card_id.in.("cardA"),place_id.in.("${PLACE_INT_B}")`,
    );
  });

  it('preserves bookmarks whose place_id is null (label-only rows)', async () => {
    state.itineraryKeys = [{ source_card_id: 'cardA', place_id: null }];
    state.bookmarks = [
      {
        id: BOOKMARK_2,
        source_card_id: 'cardA',
        place_id: null,
        category: 'other',
        notes: 'Mystery temple — note',
        place: null,
      },
    ];
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    const body = (await res.json()) as {
      bookmarks: Array<{ id: string; place_id: string | null; place: unknown }>;
    };
    expect(body.bookmarks).toHaveLength(1);
    expect(body.bookmarks[0].place_id).toBeNull();
    expect(body.bookmarks[0].place).toBeNull();
  });

  it('orders rows by place name (alpha) then id, stable', async () => {
    state.itineraryKeys = [
      { source_card_id: 'cardA', place_id: PLACE_INT_A },
    ];
    state.bookmarks = [
      {
        id: BOOKMARK_3,
        source_card_id: 'cardC',
        place_id: PLACE_INT_A,
        category: 'sight',
        notes: null,
        place: placeEmbed('ChIJ_z', 'Zoo'),
      },
      {
        id: BOOKMARK_1,
        source_card_id: 'cardA',
        place_id: PLACE_INT_A,
        category: 'restaurant',
        notes: null,
        place: placeEmbed('ChIJ_a', 'Aoyama Cafe'),
      },
    ];
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    const body = (await res.json()) as {
      bookmarks: Array<{ place: { name: string } | null }>;
    };
    expect(body.bookmarks.map((b) => b.place?.name)).toEqual([
      'Aoyama Cafe',
      'Zoo',
    ]);
  });

  it('returns 500 on itinerary-items DB error', async () => {
    state.itineraryError = { message: 'pg down' };
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 on bookmarks DB error', async () => {
    state.itineraryKeys = [{ source_card_id: 'cardA', place_id: null }];
    state.bookmarksError = { message: 'pg down' };
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(500);
  });

  it('accepts PostgREST single-element-array embed for `place`', async () => {
    state.itineraryKeys = [
      { source_card_id: null, place_id: PLACE_INT_A },
    ];
    // Simulate PostgREST returning the FK as a single-element array.
    state.bookmarks = [
      {
        id: BOOKMARK_1,
        source_card_id: null,
        place_id: PLACE_INT_A,
        category: 'restaurant',
        notes: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        place: [placeEmbed('ChIJ_arr', 'Array Embed')] as any,
      },
    ];
    const res = await GET(
      makeReq(FIXED_TRIP_ID, FIXED_DAY_ID),
      ctxFor(FIXED_TRIP_ID, FIXED_DAY_ID),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bookmarks: Array<{ place: { name: string } | null }>;
    };
    expect(body.bookmarks[0].place?.name).toBe('Array Embed');
  });
});
