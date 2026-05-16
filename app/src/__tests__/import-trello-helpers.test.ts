/**
 * Unit tests for pure helpers in app/scripts/import-trello.ts (B-016).
 *
 * Scope: deterministic, no Supabase. Covers label routing, transport-mode
 * inference, hotel pairing, anon-key JWT guard, CLI parsing, and Trello
 * dated-list parsing. End-to-end --dry-run + DB import are deferred to UAT
 * (no test-DB infra in CI).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseArgs,
  looksLikeAnonKey,
  parseDatedList,
  classify,
  inferTransportMode,
  hotelKind,
  pairHotels,
  labelToItineraryType,
  planBackfillCard,
  categoryToItemType,
  isBookmarkPlaceIdLocked,
  isItineraryPlaceIdLocked,
  computeDiagnostic,
  type Summary,
  type DiagnosticRow,
} from '../../scripts/import-trello';

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

interface TrelloLabelLite {
  id: string;
  name: string;
}

interface TrelloCardLite {
  id: string;
  name: string;
  desc: string | null;
  idList: string;
  labels: TrelloLabelLite[];
  closed: boolean;
}

function makeCard(partial: Partial<TrelloCardLite> & { id: string; name: string }): TrelloCardLite {
  return {
    desc: null,
    idList: 'list-1',
    labels: [],
    closed: false,
    ...partial,
  };
}

function makeSummary(): Summary {
  return {
    trips: 0,
    days: 0,
    items: 0,
    transportation: 0,
    accommodations: 0,
    bookmarks: 0,
    skipped: 0,
    errors: 0,
    backfilled: 0,
    unpairedHotels: [],
    unlabeledCardIds: [],
  };
}

// Minimal JWT builder — `{header}.{payload}.{sig}` with base64url payload.
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) =>
    Buffer.from(s, 'utf8')
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.signature-stub`;
}

// ---------------------------------------------------------------------------
// 1. CLI arg parsing.
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('--user-email value form', () => {
    expect(parseArgs(['--user-email', 'me@example.com'])).toEqual({
      userEmail: 'me@example.com',
      dryRun: false,
      backfill: false,
      diagnose: false,
      tripId: null,
    });
  });

  it('--user-email=value form', () => {
    expect(parseArgs(['--user-email=me@example.com'])).toEqual({
      userEmail: 'me@example.com',
      dryRun: false,
      backfill: false,
      diagnose: false,
      tripId: null,
    });
  });

  it('--dry-run flag toggles', () => {
    expect(parseArgs(['--user-email', 'a@b.co', '--dry-run'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: true,
      backfill: false,
      diagnose: false,
      tripId: null,
    });
  });

  it('--backfill flag toggles', () => {
    expect(parseArgs(['--user-email', 'a@b.co', '--backfill'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: false,
      backfill: true,
      diagnose: false,
      tripId: null,
    });
  });

  it('--backfill + --dry-run combine', () => {
    expect(parseArgs(['--user-email', 'a@b.co', '--backfill', '--dry-run'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: true,
      backfill: true,
      diagnose: false,
      tripId: null,
    });
  });

  it('throws when --user-email missing', () => {
    expect(() => parseArgs([])).toThrow(/--user-email/);
  });

  it('throws when --user-email has no value', () => {
    expect(() => parseArgs(['--user-email'])).toThrow(/--user-email/);
  });

  // B-022 R5 — additional flag combinations.
  it('throws when --backfill is set but --user-email is missing', () => {
    expect(() => parseArgs(['--backfill'])).toThrow(/--user-email/);
  });

  it('--dry-run alone (regular import) still requires --user-email', () => {
    expect(() => parseArgs(['--dry-run'])).toThrow(/--user-email/);
    expect(parseArgs(['--dry-run', '--user-email', 'a@b.co'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: true,
      backfill: false,
      diagnose: false,
      tripId: null,
    });
  });

  it('--backfill + --dry-run order independence', () => {
    expect(parseArgs(['--dry-run', '--backfill', '--user-email', 'a@b.co'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: true,
      backfill: true,
      diagnose: false,
      tripId: null,
    });
    expect(parseArgs(['--backfill', '--user-email=a@b.co', '--dry-run'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: true,
      backfill: true,
      diagnose: false,
      tripId: null,
    });
  });

  // B-030 — diagnostic flag + optional --trip-id override.
  it('--diagnose flag toggles', () => {
    expect(parseArgs(['--user-email', 'a@b.co', '--diagnose'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: false,
      backfill: false,
      diagnose: true,
      tripId: null,
    });
  });

  it('--trip-id value form', () => {
    expect(
      parseArgs([
        '--user-email',
        'a@b.co',
        '--diagnose',
        '--trip-id',
        '11111111-1111-4111-8111-111111111111',
      ]),
    ).toEqual({
      userEmail: 'a@b.co',
      dryRun: false,
      backfill: false,
      diagnose: true,
      tripId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('--trip-id=value form', () => {
    expect(
      parseArgs([
        '--user-email=a@b.co',
        '--diagnose',
        '--trip-id=22222222-2222-4222-8222-222222222222',
      ]),
    ).toEqual({
      userEmail: 'a@b.co',
      dryRun: false,
      backfill: false,
      diagnose: true,
      tripId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('throws when --trip-id has no value', () => {
    expect(() =>
      parseArgs(['--user-email', 'a@b.co', '--diagnose', '--trip-id']),
    ).toThrow(/--trip-id/);
  });
});

// ---------------------------------------------------------------------------
// 7. B-022 label → itinerary_items.type mapping.
// ---------------------------------------------------------------------------

describe('labelToItineraryType (B-022)', () => {
  it('Restaurants → meal', () => {
    expect(labelToItineraryType('Restaurants')).toBe('meal');
  });

  it('Attractions / Museums / Shopping → activity', () => {
    expect(labelToItineraryType('Attractions')).toBe('activity');
    expect(labelToItineraryType('Museums')).toBe('activity');
    expect(labelToItineraryType('Shopping')).toBe('activity');
  });

  it('is case-insensitive', () => {
    expect(labelToItineraryType('restaurants')).toBe('meal');
    expect(labelToItineraryType('ATTRACTIONS')).toBe('activity');
    expect(labelToItineraryType('  museums  ')).toBe('activity');
  });

  it('returns null for non-itinerary labels (Hotels, Transportation)', () => {
    expect(labelToItineraryType('Hotels')).toBeNull();
    expect(labelToItineraryType('Transportation')).toBeNull();
  });

  it('returns null for unknown labels and empty input', () => {
    expect(labelToItineraryType('Random')).toBeNull();
    expect(labelToItineraryType('')).toBeNull();
  });

  // B-022 R5 edge cases.
  it('whitespace-only input returns null', () => {
    expect(labelToItineraryType('   ')).toBeNull();
  });

  it('mixed-case spelling normalises', () => {
    expect(labelToItineraryType('ResTauRants')).toBe('meal');
    expect(labelToItineraryType('SHOPPING')).toBe('activity');
    expect(labelToItineraryType('\tAttractions\n')).toBe('activity');
  });
});

// ---------------------------------------------------------------------------
// 8. B-022 backfill planner — pure decision tree.
// ---------------------------------------------------------------------------

describe('planBackfillCard (B-022)', () => {
  const TRIP_DATED_LIST_ID = 'L-13nov';
  const TRIP_DATE = '2026-11-13';

  function makeCardsById(cards: TrelloCardLite[]): Map<string, TrelloCardLite> {
    const m = new Map<string, TrelloCardLite>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }
  function listMap(): Map<string, string> {
    return new Map([[TRIP_DATED_LIST_ID, TRIP_DATE]]);
  }

  it('bookmark in paired-set → already-paired', () => {
    const cand = { source_card_id: 'card-1', place_id: null, category: 'restaurant' as const };
    const plan = planBackfillCard(cand, makeCardsById([]), listMap(), new Set(['card-1']));
    expect(plan).toEqual({ action: 'already-paired' });
  });

  it('bookmark not in paired-set + card not in export → no-dated-list', () => {
    const cand = { source_card_id: 'missing', place_id: null, category: 'sight' as const };
    const plan = planBackfillCard(cand, makeCardsById([]), listMap(), new Set());
    expect(plan).toEqual({ action: 'no-dated-list' });
  });

  it('bookmark not in paired-set + card on non-dated list → no-dated-list', () => {
    const card = makeCard({ id: 'card-2', name: 'Sushi', idList: 'L-toplan' });
    const cand = { source_card_id: 'card-2', place_id: null, category: 'restaurant' as const };
    const plan = planBackfillCard(cand, makeCardsById([card]), listMap(), new Set());
    expect(plan).toEqual({ action: 'no-dated-list' });
  });

  it('bookmark not in paired-set + card on dated, in-range list → new-item (restaurant → meal)', () => {
    const card = makeCard({ id: 'card-3', name: 'Lunch', idList: TRIP_DATED_LIST_ID });
    const cand = {
      source_card_id: 'card-3',
      place_id: 'place-abc',
      category: 'restaurant' as const,
    };
    const plan = planBackfillCard(cand, makeCardsById([card]), listMap(), new Set());
    expect(plan).toEqual({
      action: 'new-item',
      date: TRIP_DATE,
      itemType: 'meal',
      placeId: 'place-abc',
    });
  });

  it('new-item routes sight/museum/shopping to activity', () => {
    const card = makeCard({ id: 'card-4', name: 'Temple', idList: TRIP_DATED_LIST_ID });
    const cardsById = makeCardsById([card]);
    const lm = listMap();
    const paired = new Set<string>();
    for (const cat of ['sight', 'museum', 'shopping'] as const) {
      const cand = { source_card_id: 'card-4', place_id: null, category: cat };
      const plan = planBackfillCard(cand, cardsById, lm, paired);
      expect(plan).toEqual({
        action: 'new-item',
        date: TRIP_DATE,
        itemType: 'activity',
        placeId: null,
      });
    }
  });
});

describe('categoryToItemType (B-022)', () => {
  it('maps each BookmarkCategory to the correct itinerary type', () => {
    expect(categoryToItemType('restaurant')).toBe('meal');
    expect(categoryToItemType('sight')).toBe('activity');
    expect(categoryToItemType('museum')).toBe('activity');
    expect(categoryToItemType('shopping')).toBe('activity');
  });
});

// ---------------------------------------------------------------------------
// 2. Anon-key JWT guard.
// ---------------------------------------------------------------------------

describe('looksLikeAnonKey', () => {
  it('returns true for role:anon JWT', () => {
    expect(looksLikeAnonKey(makeJwt({ role: 'anon', iss: 'supabase' }))).toBe(true);
  });

  it('returns false for role:service_role JWT', () => {
    expect(looksLikeAnonKey(makeJwt({ role: 'service_role', iss: 'supabase' }))).toBe(false);
  });

  it('returns false for non-JWT string', () => {
    expect(looksLikeAnonKey('not-a-jwt')).toBe(false);
  });

  it('returns false for malformed JWT (wrong segment count)', () => {
    expect(looksLikeAnonKey('a.b')).toBe(false);
  });

  it('returns false for JWT with non-JSON payload', () => {
    expect(looksLikeAnonKey('aaa.bbb.ccc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Trello dated-list parsing.
// ---------------------------------------------------------------------------

describe('parseDatedList', () => {
  it('parses DD.MM.YYYY inside trip range', () => {
    expect(parseDatedList('13.11.2026')).toBe('2026-11-13');
    expect(parseDatedList('08.12.2026')).toBe('2026-12-08');
  });

  it('returns null for non-dated lists (e.g. "To Plan")', () => {
    expect(parseDatedList('To Plan')).toBeNull();
    expect(parseDatedList('Inbox')).toBeNull();
  });

  it('returns null for dates outside the trip range', () => {
    expect(parseDatedList('12.11.2026')).toBeNull(); // before start
    expect(parseDatedList('09.12.2026')).toBeNull(); // after end
    expect(parseDatedList('15.06.2024')).toBeNull(); // archive year
  });

  it('trims whitespace', () => {
    expect(parseDatedList('  20.11.2026  ')).toBe('2026-11-20');
  });
});

describe('Trello export structural parse — identifies dated lists only', () => {
  it('counts dated lists inside trip range across a mixed export', () => {
    const lists = [
      { id: 'L1', name: '13.11.2026', closed: false },
      { id: 'L2', name: '14.11.2026', closed: false },
      { id: 'L3', name: 'To Plan', closed: false },
      { id: 'L4', name: '08.12.2026', closed: false },
      { id: 'L5', name: '09.12.2026', closed: false }, // out of range
      { id: 'L6', name: '15.06.2024', closed: false }, // archive
      { id: 'L7', name: 'Inbox', closed: true },
    ];
    const dated = lists
      .filter((l) => !l.closed)
      .map((l) => parseDatedList(l.name))
      .filter((iso): iso is string => iso !== null);
    expect(dated).toEqual(['2026-11-13', '2026-11-14', '2026-12-08']);
  });
});

// ---------------------------------------------------------------------------
// 4. Label routing.
// ---------------------------------------------------------------------------

describe('classify', () => {
  it('Transportation label → transportation', () => {
    expect(classify(makeCard({ id: 'c1', name: 'x', labels: [{ id: 'l', name: 'Transportation' }] })))
      .toBe('transportation');
  });

  it('Hotels label → hotels', () => {
    expect(classify(makeCard({ id: 'c1', name: 'x', labels: [{ id: 'l', name: 'Hotels' }] })))
      .toBe('hotels');
  });

  it('Restaurants/Museums/Attractions/Shopping route correctly', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Restaurants' }] }))).toBe('restaurants');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Museums' }] }))).toBe('museums');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Attractions' }] }))).toBe('attractions');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Shopping' }] }))).toBe('shopping');
  });

  it('matches case-insensitively', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'TRANSPORTATION' }] }))).toBe('transportation');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'restaurants' }] }))).toBe('restaurants');
  });

  it('no labels → unlabeled (note)', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [] }))).toBe('unlabeled');
  });

  it('unknown label → unlabeled', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Random' }] }))).toBe('unlabeled');
  });
});

// ---------------------------------------------------------------------------
// 5. Transport mode inference.
// ---------------------------------------------------------------------------

describe('inferTransportMode', () => {
  it.each([
    ['Flight to Tokyo', 'flight'],
    ['Shinkansen Train', 'train'],
    ['Bus to Kyoto', 'bus'],
    ['Car rental', 'car'],
    ['Ferry to Miyajima', 'ferry'],
    ['Walking tour', 'other'],
    ['Random unrecognized', 'other'],
  ] as const)('"%s" → %s', (name, expected) => {
    expect(inferTransportMode(name)).toBe(expected);
  });

  // B-020: explicit mode keywords must win over "airport" destination noise.
  it.each([
    ['Bus to airport', 'bus'],
    ['Train to Narita Airport', 'train'],
    ['Flight to Tokyo', 'flight'],
    ['Airport transfer', 'other'],
  ] as const)('B-020 priority: "%s" → %s', (name, expected) => {
    expect(inferTransportMode(name)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 6. Hotel pairing algorithm.
// ---------------------------------------------------------------------------

describe('hotelKind', () => {
  it('parses "Checkin - Hotel X"', () => {
    expect(hotelKind('Checkin - Hotel Tokyo')).toEqual({ kind: 'checkin', canonical: 'Hotel Tokyo' });
  });
  it('parses "Checkout - Hotel X"', () => {
    expect(hotelKind('Checkout - Hotel Tokyo')).toEqual({ kind: 'checkout', canonical: 'Hotel Tokyo' });
  });
  it('treats unknown prefix as unknown', () => {
    expect(hotelKind('Random Hotel').kind).toBe('unknown');
  });
});

describe('pairHotels', () => {
  // Silence logWarn/logError stderr noise during these tests.
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('pairs simple 1 checkin + 1 checkout for same hotel', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [
        { card: makeCard({ id: 'a', name: 'Checkin - Park Hotel' }), date: '2026-11-13' },
        { card: makeCard({ id: 'b', name: 'Checkout - Park Hotel' }), date: '2026-11-15' },
      ],
      summary,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      canonical: 'Park Hotel',
      checkInDate: '2026-11-13',
      checkOutDate: '2026-11-15',
      sourceCardId: 'a',
    });
    expect(summary.errors).toBe(0);
    expect(summary.unpairedHotels).toEqual([]);
  });

  it('unpaired Checkin → defaults to +1 day, records unpairedHotels and warns', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [{ card: makeCard({ id: 'a', name: 'Checkin - Solo Hotel' }), date: '2026-11-20' }],
      summary,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      canonical: 'Solo Hotel',
      checkInDate: '2026-11-20',
      checkOutDate: '2026-11-21',
    });
    expect(summary.unpairedHotels).toContain('checkin:Solo Hotel');
    expect(summary.errors).toBe(0); // unpaired-checkin is a warning, not an error
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('unpaired Checkout → skipped, records unpairedHotels, increments errors', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [{ card: makeCard({ id: 'a', name: 'Checkout - Ghost Hotel' }), date: '2026-11-22' }],
      summary,
    );
    expect(pairs).toHaveLength(0);
    expect(summary.unpairedHotels).toContain('checkout:Ghost Hotel');
    expect(summary.errors).toBe(1);
  });

  it('duplicate names across cards pair chronologically', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [
        { card: makeCard({ id: 'ci-a', name: 'Checkin - Repeat Hotel' }), date: '2026-11-13' },
        { card: makeCard({ id: 'co-a', name: 'Checkout - Repeat Hotel' }), date: '2026-11-15' },
        { card: makeCard({ id: 'ci-b', name: 'Checkin - Repeat Hotel' }), date: '2026-11-25' },
        { card: makeCard({ id: 'co-b', name: 'Checkout - Repeat Hotel' }), date: '2026-11-28' },
      ],
      summary,
    );
    expect(pairs).toHaveLength(2);
    // Pairs should be in chronological order by check-in.
    const sorted = [...pairs].sort((a, b) => a.checkInDate.localeCompare(b.checkInDate));
    expect(sorted[0]).toMatchObject({ checkInDate: '2026-11-13', checkOutDate: '2026-11-15', sourceCardId: 'ci-a' });
    expect(sorted[1]).toMatchObject({ checkInDate: '2026-11-25', checkOutDate: '2026-11-28', sourceCardId: 'ci-b' });
    expect(summary.errors).toBe(0);
  });

  it('mixed-date input is sorted before pairing (earliest checkout >= checkin)', () => {
    const summary = makeSummary();
    // Provide entries in scrambled order; expected pairing should still match earliest valid checkout.
    const pairs = pairHotels(
      [
        { card: makeCard({ id: 'co-late', name: 'Checkout - Mix Hotel' }), date: '2026-11-28' },
        { card: makeCard({ id: 'ci-early', name: 'Checkin - Mix Hotel' }), date: '2026-11-13' },
        { card: makeCard({ id: 'ci-late', name: 'Checkin - Mix Hotel' }), date: '2026-11-25' },
        { card: makeCard({ id: 'co-early', name: 'Checkout - Mix Hotel' }), date: '2026-11-15' },
      ],
      summary,
    );
    expect(pairs).toHaveLength(2);
    const byCheckin = [...pairs].sort((a, b) => a.checkInDate.localeCompare(b.checkInDate));
    expect(byCheckin[0]).toMatchObject({ checkInDate: '2026-11-13', checkOutDate: '2026-11-15' });
    expect(byCheckin[1]).toMatchObject({ checkInDate: '2026-11-25', checkOutDate: '2026-11-28' });
  });

  it('hotel card without checkin/checkout prefix → skipped + summary.skipped++', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [{ card: makeCard({ id: 'a', name: 'Random Hotel Note' }), date: '2026-11-20' }],
      summary,
    );
    expect(pairs).toHaveLength(0);
    expect(summary.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 9. B-026 place_id_locked guards — bookmarks + itinerary_items.
// ---------------------------------------------------------------------------

describe('isBookmarkPlaceIdLocked / isItineraryPlaceIdLocked (B-026)', () => {
  function makeCtx(
    lockedValue: boolean | null,
    table: 'bookmarks' | 'itinerary_items',
    fromCalls: string[] = [],
    errorMsg: string | null = null,
  ): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any;
    fromCalls: string[];
  } {
    const eqArgs: Array<[string, string]> = [];
    const client = {
      from: (t: string) => {
        fromCalls.push(t);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
          select: () => chain,
          eq: (col: string, val: string) => {
            eqArgs.push([col, val]);
            return chain;
          },
          maybeSingle: async () => {
            if (errorMsg) return { data: null, error: { message: errorMsg } };
            if (t !== table) return { data: null, error: null };
            return lockedValue === null
              ? { data: null, error: null }
              : { data: { place_id_locked: lockedValue }, error: null };
          },
        };
        return chain;
      },
    };
    return {
      ctx: {
        client,
        tripId: 'trip-1',
        ownerId: 'user-1',
        daysByDate: new Map(),
        dryRun: false,
        summary: makeSummary(),
      },
      fromCalls,
    };
  }
  const card = makeCard({ id: 'card-X', name: 'Pinned Place' });

  it('returns true when bookmarks row exists with place_id_locked=true', async () => {
    const { ctx } = makeCtx(true, 'bookmarks');
    expect(await isBookmarkPlaceIdLocked(ctx, card)).toBe(true);
  });

  it('returns false when bookmarks row has place_id_locked=false', async () => {
    const { ctx } = makeCtx(false, 'bookmarks');
    expect(await isBookmarkPlaceIdLocked(ctx, card)).toBe(false);
  });

  it('returns false when no bookmarks row exists for the card', async () => {
    const { ctx } = makeCtx(null, 'bookmarks');
    expect(await isBookmarkPlaceIdLocked(ctx, card)).toBe(false);
  });

  it('throws when the bookmarks lock-check select returns an error', async () => {
    const { ctx } = makeCtx(null, 'bookmarks', [], 'boom');
    await expect(isBookmarkPlaceIdLocked(ctx, card)).rejects.toThrow(
      /bookmarks lock-check/,
    );
  });

  it('returns true for itinerary_items when locked', async () => {
    const { ctx } = makeCtx(true, 'itinerary_items');
    expect(await isItineraryPlaceIdLocked(ctx, card)).toBe(true);
  });

  it('returns false for itinerary_items when no row exists', async () => {
    const { ctx } = makeCtx(null, 'itinerary_items');
    expect(await isItineraryPlaceIdLocked(ctx, card)).toBe(false);
  });

  it('throws when the itinerary_items lock-check returns an error', async () => {
    const { ctx } = makeCtx(null, 'itinerary_items', [], 'kaboom');
    await expect(isItineraryPlaceIdLocked(ctx, card)).rejects.toThrow(
      /itinerary_items lock-check/,
    );
  });
});

// ---------------------------------------------------------------------------
// B-030 — diagnostic aggregation (read-only branch-decision helper).
// computeDiagnostic is a pure function — given the Trello cardId→date map
// plus raw bookmarks/items lists, produce the per-date table with `gap`.
// ---------------------------------------------------------------------------

describe('computeDiagnostic (B-030)', () => {
  const cardIdToDate = new Map<string, string>([
    ['c1', '2026-11-15'],
    ['c2', '2026-11-15'],
    ['c3', '2026-11-15'],
    ['c4', '2026-11-16'],
    ['c5', '2026-11-16'],
    // c6 not present → bookmark on non-dated list, excluded from totals.
  ]);

  it('returns empty when no bookmarks or items have dated source cards', () => {
    expect(computeDiagnostic([], [], cardIdToDate)).toEqual([]);
  });

  it('Branch A scenario — bookmarks present, paired items zero everywhere', () => {
    const rows = computeDiagnostic(
      [
        { source_card_id: 'c1' },
        { source_card_id: 'c2' },
        { source_card_id: 'c3' },
        { source_card_id: 'c4' },
      ],
      [],
      cardIdToDate,
    );
    const expected: DiagnosticRow[] = [
      { date: '2026-11-15', bookmarks: 3, pairedItems: 0, gap: 3 },
      { date: '2026-11-16', bookmarks: 1, pairedItems: 0, gap: 1 },
    ];
    expect(rows).toEqual(expected);
  });

  it('No-gap scenario — bookmarks and paired items align on every date', () => {
    const rows = computeDiagnostic(
      [
        { source_card_id: 'c1' },
        { source_card_id: 'c4' },
      ],
      [
        { source_card_id: 'c1' },
        { source_card_id: 'c4' },
      ],
      cardIdToDate,
    );
    for (const r of rows) expect(r.gap).toBe(0);
  });

  it('Partial-gap scenario — Branch B candidate when some dates have paired but UI shows zero', () => {
    const rows = computeDiagnostic(
      [
        { source_card_id: 'c1' },
        { source_card_id: 'c2' },
        { source_card_id: 'c4' },
      ],
      [
        { source_card_id: 'c4' }, // 11-16 paired; 11-15 unpaired
      ],
      cardIdToDate,
    );
    const day15 = rows.find((r) => r.date === '2026-11-15');
    const day16 = rows.find((r) => r.date === '2026-11-16');
    expect(day15).toEqual({
      date: '2026-11-15',
      bookmarks: 2,
      pairedItems: 0,
      gap: 2,
    });
    expect(day16).toEqual({
      date: '2026-11-16',
      bookmarks: 1,
      pairedItems: 1,
      gap: 0,
    });
  });

  it('ignores bookmarks/items whose source_card_id is not on a dated list', () => {
    const rows = computeDiagnostic(
      [{ source_card_id: 'c6' }, { source_card_id: 'c1' }],
      [{ source_card_id: 'c6' }],
      cardIdToDate,
    );
    expect(rows).toEqual([
      { date: '2026-11-15', bookmarks: 1, pairedItems: 0, gap: 1 },
    ]);
  });

  it('deduplicates by source_card_id (no double-counting if duplicate rows)', () => {
    const rows = computeDiagnostic(
      [
        { source_card_id: 'c1' },
        { source_card_id: 'c1' }, // duplicate — counted once
      ],
      [
        { source_card_id: 'c1' },
        { source_card_id: 'c1' },
      ],
      cardIdToDate,
    );
    expect(rows).toEqual([
      { date: '2026-11-15', bookmarks: 1, pairedItems: 1, gap: 0 },
    ]);
  });

  it('rows are sorted ascending by date', () => {
    const rows = computeDiagnostic(
      [
        { source_card_id: 'c4' },
        { source_card_id: 'c1' },
      ],
      [],
      cardIdToDate,
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-11-15', '2026-11-16']);
  });
});

// ---------------------------------------------------------------------------
// B-030 — Branch C safety net: the backfill planner reaches `new-item` for a
// dated-list candidate that hasn't been paired yet. This codifies that the
// loop's decision tree doesn't silently skip valid candidates — if a future
// regression flips this, --backfill would produce zero inserts despite
// candidates being present.
// ---------------------------------------------------------------------------

describe('runBackfill planner reaches new-item (B-030 Branch C regression net)', () => {
  it('returns new-item for an unpaired bookmark on a dated list', () => {
    const cardsById = new Map<string, TrelloCardLite>([
      [
        'card-A',
        {
          id: 'card-A',
          name: 'Sensoji Temple',
          desc: null,
          idList: 'list-1115',
          labels: [],
          closed: false,
        },
      ],
    ]);
    const listDateById = new Map<string, string>([['list-1115', '2026-11-15']]);
    const pairedCardIds = new Set<string>(); // none paired yet
    const plan = planBackfillCard(
      { source_card_id: 'card-A', place_id: null, category: 'sight' },
      cardsById,
      listDateById,
      pairedCardIds,
    );
    expect(plan).toEqual({
      action: 'new-item',
      date: '2026-11-15',
      itemType: 'activity',
      placeId: null,
    });
  });

  it('returns already-paired when the card is in the paired set', () => {
    const cardsById = new Map<string, TrelloCardLite>([
      [
        'card-B',
        { id: 'card-B', name: 'x', desc: null, idList: 'list-1', labels: [], closed: false },
      ],
    ]);
    const listDateById = new Map<string, string>([['list-1', '2026-11-15']]);
    const pairedCardIds = new Set<string>(['card-B']);
    const plan = planBackfillCard(
      { source_card_id: 'card-B', place_id: null, category: 'sight' },
      cardsById,
      listDateById,
      pairedCardIds,
    );
    expect(plan).toEqual({ action: 'already-paired' });
  });
});
