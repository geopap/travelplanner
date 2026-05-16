/**
 * @vitest-environment jsdom
 *
 * B-031 — End-to-end-style integration for the "Bookmarks for this day"
 * section. Existing tests cover the route and the component in isolation;
 * this suite glues them together by mocking the Supabase client used by the
 * REAL endpoint, calling GET via the route handler, feeding the response
 * through a fetch stub, and asserting that `DayBookmarksSection` renders the
 * rows the server returned.
 *
 * Also pins the critical multi-trip data-isolation invariant: a bookmark in
 * trip A whose `place_id` is also linked to an itinerary item in trip B does
 * NOT appear in trip B's day view (and vice versa). The pairing query is
 * trip-scoped (`.eq('trip_id', tripId)` on both rounds), so swapping the
 * tripId at the route boundary must yield disjoint result sets.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & Record<string, unknown>) =>
    React.createElement('a', { href, ...(rest as Record<string, unknown>) }, children),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

// Role state per-test; the route uses checkTripAccess with required='viewer'.
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

const FIXED_USER_ID = '00000000-0000-4000-8000-000000000001';
const TRIP_A = '00000000-0000-4000-8000-0000000000a1';
const TRIP_B = '00000000-0000-4000-8000-0000000000b1';
const DAY_A = '00000000-0000-4000-8000-0000000000a2';
const DAY_B = '00000000-0000-4000-8000-0000000000b2';

// Shared place_id appearing in BOTH trips' itineraries and bookmarks.
const SHARED_PLACE_UUID = '00000000-0000-4000-8000-0000000000aa';

const BOOKMARK_TRIP_A = '00000000-0000-4000-8000-0000000000c1';
const BOOKMARK_TRIP_B = '00000000-0000-4000-8000-0000000000c2';

interface RawItineraryKey {
  trip_id: string;
  day_id: string;
  source_card_id: string | null;
  place_id: string | null;
}

interface RawBookmark {
  id: string;
  trip_id: string;
  source_card_id: string | null;
  place_id: string | null;
  category: 'restaurant' | 'sight' | 'museum' | 'shopping' | 'other';
  notes: string | null;
  place: {
    google_place_id: string;
    name: string;
    formatted_address: string | null;
  } | null;
}

interface FakeWorld {
  days: Array<{ id: string; trip_id: string }>;
  itineraryItems: RawItineraryKey[];
  bookmarks: RawBookmark[];
}

const world: FakeWorld = {
  days: [
    { id: DAY_A, trip_id: TRIP_A },
    { id: DAY_B, trip_id: TRIP_B },
  ],
  itineraryItems: [
    { trip_id: TRIP_A, day_id: DAY_A, source_card_id: 'cardA', place_id: SHARED_PLACE_UUID },
    { trip_id: TRIP_B, day_id: DAY_B, source_card_id: 'cardB', place_id: SHARED_PLACE_UUID },
  ],
  bookmarks: [
    {
      id: BOOKMARK_TRIP_A,
      trip_id: TRIP_A,
      source_card_id: 'cardA',
      place_id: SHARED_PLACE_UUID,
      category: 'restaurant',
      notes: null,
      place: {
        google_place_id: 'ChIJ_tripA_only',
        name: 'Trip A Sushi',
        formatted_address: '1-1 Tokyo',
      },
    },
    {
      id: BOOKMARK_TRIP_B,
      trip_id: TRIP_B,
      source_card_id: 'cardB',
      place_id: SHARED_PLACE_UUID,
      category: 'restaurant',
      notes: null,
      place: {
        google_place_id: 'ChIJ_tripB_only',
        name: 'Trip B Sushi',
        formatted_address: '2-2 Kyoto',
      },
    },
  ],
};

// Build a chained query whose filters narrow the world and resolve at .limit().
function buildChain(table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  let orFilter: ((r: Record<string, unknown>) => boolean) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    filters.push((r) => r[col] === val);
    return chain;
  };
  chain.or = (clause: string) => {
    // Parse the very limited grammar we actually emit:
    //   "source_card_id.in.(\"x\",\"y\"),place_id.in.(\"u\")"
    // Each arm is independent; OR is union across arms.
    const arms: Array<(r: Record<string, unknown>) => boolean> = [];
    const re = /(source_card_id|place_id)\.in\.\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clause)) !== null) {
      const col = m[1];
      const values = m[2]
        .split(',')
        .map((v) => v.trim().replace(/^"|"$/g, ''));
      arms.push((r) => values.includes(String(r[col] ?? '')));
    }
    orFilter = (r) => arms.some((arm) => arm(r));
    return chain;
  };
  chain.maybeSingle = async () => {
    if (table === 'trip_days') {
      const match = world.days.find((d) =>
        filters.every((f) => f(d as unknown as Record<string, unknown>)),
      );
      return { data: match ?? null, error: null };
    }
    return { data: null, error: null };
  };
  chain.limit = async () => {
    if (table === 'itinerary_items') {
      const rows = world.itineraryItems
        .filter((r) =>
          filters.every((f) => f(r as unknown as Record<string, unknown>)),
        )
        .map((r) => ({ source_card_id: r.source_card_id, place_id: r.place_id }));
      return { data: rows, error: null };
    }
    if (table === 'bookmarks') {
      const rows = world.bookmarks
        .filter((r) =>
          filters.every((f) => f(r as unknown as Record<string, unknown>)),
        )
        .filter((r) => (orFilter ? orFilter(r as unknown as Record<string, unknown>) : true))
        .map((r) => ({
          id: r.id,
          source_card_id: r.source_card_id,
          place_id: r.place_id,
          category: r.category,
          notes: r.notes,
          place: r.place,
        }));
      return { data: rows, error: null };
    }
    return { data: [], error: null };
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }) },
    from: (t: string) => buildChain(t),
  }),
}));

// Import AFTER mocks.
import { GET } from '@/app/api/trips/[id]/days/[dayId]/bookmarks/route';
import { DayBookmarksSection } from '@/components/itinerary/DayBookmarksSection';
import { NextRequest } from 'next/server';

const fetchMock = vi.fn();
beforeEach(() => {
  role = 'viewer';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // Default the matchMedia matcher to "md+" so the section auto-expands.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
  try {
    window.localStorage?.clear?.();
  } catch {
    // jsdom may run without storage; not critical.
  }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Wire the component's `fetch` to the REAL route handler so the test exercises
 * the full pipeline: pairing.ts → endpoint → JSON → DayBookmarksSection.
 */
function wireFetchToRoute() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const m = /\/api\/trips\/([^/]+)\/days\/([^/]+)\/bookmarks$/.exec(url);
    if (!m) throw new Error(`Unrouted fetch in integration test: ${url}`);
    const tripId = decodeURIComponent(m[1]);
    const dayId = decodeURIComponent(m[2]);
    const req = new NextRequest(`http://localhost${url}`, { method: 'GET' });
    const res = await GET(req, { params: Promise.resolve({ id: tripId, dayId }) });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('B-031 integration — pairing.ts → endpoint → DayBookmarksSection', () => {
  it('renders the paired bookmark for trip A only — trip B bookmark is excluded', async () => {
    wireFetchToRoute();
    render(<DayBookmarksSection tripId={TRIP_A} dayId={DAY_A} />);

    // The section is rendered (matchMedia true → expanded by default).
    const section = await screen.findByRole('region', {
      name: /bookmarks for this day/i,
    });

    // Trip A's bookmark is visible.
    expect(within(section).getByText('Trip A Sushi')).toBeTruthy();

    // Trip B's bookmark — despite sharing the same place_id — must NOT appear.
    expect(within(section).queryByText('Trip B Sushi')).toBeNull();

    // Click-through link uses trip A's google_place_id and trip A's id.
    const link = within(section).getByRole('link', { name: /Trip A Sushi/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(
      `/places/ChIJ_tripA_only?trip=${encodeURIComponent(TRIP_A)}`,
    );
  });

  it('renders the paired bookmark for trip B only — trip A bookmark is excluded (inverse isolation)', async () => {
    wireFetchToRoute();
    render(<DayBookmarksSection tripId={TRIP_B} dayId={DAY_B} />);

    const section = await screen.findByRole('region', {
      name: /bookmarks for this day/i,
    });
    expect(within(section).getByText('Trip B Sushi')).toBeTruthy();
    expect(within(section).queryByText('Trip A Sushi')).toBeNull();
  });

  it('issues the correct GET URL shape (tripId + dayId encoded)', async () => {
    wireFetchToRoute();
    render(<DayBookmarksSection tripId={TRIP_A} dayId={DAY_A} />);

    await screen.findByRole('region', { name: /bookmarks for this day/i });

    // Find the bookmarks fetch call (the wireFetchToRoute filter would have
    // thrown for anything that didn't match the URL pattern).
    const called = fetchMock.mock.calls.find(([url]) => {
      const u = typeof url === 'string' ? url : String(url);
      return u.endsWith('/bookmarks');
    });
    expect(called).toBeTruthy();
    const calledUrl = String(called?.[0]);
    expect(calledUrl).toBe(
      `/api/trips/${encodeURIComponent(TRIP_A)}/days/${encodeURIComponent(DAY_A)}/bookmarks`,
    );
  });

  it('hides the section when the endpoint returns an empty list', async () => {
    // Swap the world to an itinerary that has no items on this trip's day so
    // the endpoint short-circuits → empty bookmark list → section hidden.
    wireFetchToRoute();
    const SOLO_TRIP = '00000000-0000-4000-8000-0000000000d1';
    const SOLO_DAY = '00000000-0000-4000-8000-0000000000d2';
    world.days.push({ id: SOLO_DAY, trip_id: SOLO_TRIP });

    render(<DayBookmarksSection tripId={SOLO_TRIP} dayId={SOLO_DAY} />);

    // Wait one microtask cycle for the fetch to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(
      screen.queryByRole('region', { name: /bookmarks for this day/i }),
    ).toBeNull();
  });
});
