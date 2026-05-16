/**
 * B-031 / B-038 — `isPaired` predicate + helper unit tests.
 *
 * The truth table is the canonical "paired" rule consumed by both B-031
 * (day-scoped) and B-038 (trip-scoped). If this drifts, both endpoints break.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPairingOrClause,
  getBookmarksWithPlannedFlag,
  getPairedBookmarkIdsForDay,
  getTripPairingKeys,
  isPaired,
} from '@/lib/bookmarks/pairing';

const PLACE_A = '00000000-0000-4000-8000-00000000aaaa';
const PLACE_B = '00000000-0000-4000-8000-00000000bbbb';
const CARD_A = 'card_aaa';
const CARD_B = 'card_bbb';

describe('isPaired — B-031/B-038 canonical predicate', () => {
  it('paired on source_card_id arm alone', () => {
    expect(
      isPaired(
        { place_id: null, source_card_id: CARD_A },
        { place_id: null, source_card_id: CARD_A },
      ),
    ).toBe(true);
  });

  it('paired on place_id arm alone', () => {
    expect(
      isPaired(
        { place_id: PLACE_A, source_card_id: null },
        { place_id: PLACE_A, source_card_id: null },
      ),
    ).toBe(true);
  });

  it('paired when BOTH arms match (single OR)', () => {
    expect(
      isPaired(
        { place_id: PLACE_A, source_card_id: CARD_A },
        { place_id: PLACE_A, source_card_id: CARD_A },
      ),
    ).toBe(true);
  });

  it('paired when one arm matches and the other differs', () => {
    expect(
      isPaired(
        { place_id: PLACE_A, source_card_id: CARD_A },
        { place_id: PLACE_B, source_card_id: CARD_A },
      ),
    ).toBe(true);
    expect(
      isPaired(
        { place_id: PLACE_A, source_card_id: CARD_A },
        { place_id: PLACE_A, source_card_id: CARD_B },
      ),
    ).toBe(true);
  });

  it('NOT paired when neither arm matches', () => {
    expect(
      isPaired(
        { place_id: PLACE_A, source_card_id: CARD_A },
        { place_id: PLACE_B, source_card_id: CARD_B },
      ),
    ).toBe(false);
  });

  it('NOT paired when bookmark has both keys null (defensive)', () => {
    expect(
      isPaired(
        { place_id: null, source_card_id: null },
        { place_id: PLACE_A, source_card_id: CARD_A },
      ),
    ).toBe(false);
  });

  it('NOT paired when both source_card_ids are null even if equal', () => {
    expect(
      isPaired(
        { place_id: PLACE_A, source_card_id: null },
        { place_id: PLACE_B, source_card_id: null },
      ),
    ).toBe(false);
  });

  it('NOT paired when bookmark place_id is null but ii place_id has a value', () => {
    expect(
      isPaired(
        { place_id: null, source_card_id: CARD_A },
        { place_id: PLACE_A, source_card_id: CARD_B },
      ),
    ).toBe(false);
  });

  it('treats missing source_card_id keys as null (forward-compatibility)', () => {
    expect(
      isPaired(
        { place_id: PLACE_A },
        { place_id: PLACE_A },
      ),
    ).toBe(true);
    expect(
      isPaired(
        { place_id: PLACE_A },
        { place_id: PLACE_B },
      ),
    ).toBe(false);
  });
});

describe('buildPairingOrClause — PostgREST .or() clause', () => {
  it('emits only the source_card arm when place_ids is empty', () => {
    const out = buildPairingOrClause({
      source_card_ids: ['c1'],
      place_ids: [],
    });
    expect(out).toBe('source_card_id.in.("c1")');
  });

  it('emits only the place arm when source_card_ids is empty', () => {
    const out = buildPairingOrClause({
      source_card_ids: [],
      place_ids: [PLACE_A],
    });
    expect(out).toBe(`place_id.in.("${PLACE_A}")`);
  });

  it('emits both arms comma-separated when both have keys', () => {
    const out = buildPairingOrClause({
      source_card_ids: ['c1', 'c2'],
      place_ids: [PLACE_A],
    });
    expect(out).toBe(
      `source_card_id.in.("c1","c2"),place_id.in.("${PLACE_A}")`,
    );
  });

  it('emits empty string when both arms are empty (caller short-circuits)', () => {
    const out = buildPairingOrClause({ source_card_ids: [], place_ids: [] });
    expect(out).toBe('');
  });

  it('double-quotes values defensively (no embedded special chars)', () => {
    const out = buildPairingOrClause({
      source_card_ids: ['safe_id'],
      place_ids: [],
    });
    expect(out).toContain('"safe_id"');
  });
});

// ---------------------------------------------------------------------------
// B-038 — getBookmarksWithPlannedFlag (trip-scoped helper).
// ---------------------------------------------------------------------------

const TRIP_ID = '00000000-0000-4000-8000-00000000c001';
const BM_1 = '00000000-0000-4000-8000-00000000bbb1';
const BM_2 = '00000000-0000-4000-8000-00000000bbb2';
const BM_3 = '00000000-0000-4000-8000-00000000bbb3';
const BM_4 = '00000000-0000-4000-8000-00000000bbb4';

interface FakeBookmarkRow {
  id: string;
  trip_id: string;
  place_id: string | null;
  source_card_id: string | null;
  category: 'restaurant' | 'sight' | 'museum' | 'shopping' | 'other';
  notes: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
  place: unknown;
}

interface FakeItineraryKey {
  source_card_id: string | null;
  place_id: string | null;
}

function makeFakeSupabase(args: {
  itineraryKeys: FakeItineraryKey[];
  bookmarks: FakeBookmarkRow[];
}): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supa: any = {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.order = () => chain;
      chain.limit = async () => {
        if (table === 'itinerary_items') {
          return { data: args.itineraryKeys, error: null };
        }
        if (table === 'bookmarks') {
          return { data: args.bookmarks, error: null };
        }
        return { data: [], error: null };
      };
      return chain;
    },
  };
  return supa as SupabaseClient;
}

function makeBookmarkRow(over: Partial<FakeBookmarkRow>): FakeBookmarkRow {
  return {
    id: over.id ?? BM_1,
    trip_id: over.trip_id ?? TRIP_ID,
    place_id: over.place_id ?? null,
    source_card_id: over.source_card_id ?? null,
    category: over.category ?? 'restaurant',
    notes: over.notes ?? null,
    added_by: over.added_by ?? null,
    created_at: over.created_at ?? '2026-05-16T00:00:00Z',
    updated_at: over.updated_at ?? '2026-05-16T00:00:00Z',
    place: over.place ?? null,
  };
}

describe('getTripPairingKeys — trip-scoped sibling of getDayPairingKeys', () => {
  it('returns dedupe key sets, dropping nulls', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [
        { source_card_id: 'c1', place_id: PLACE_A },
        { source_card_id: 'c1', place_id: PLACE_A },
        { source_card_id: null, place_id: PLACE_B },
        { source_card_id: 'c2', place_id: null },
      ],
      bookmarks: [],
    });
    const keys = await getTripPairingKeys(sb, { tripId: TRIP_ID });
    expect(keys.source_card_ids.sort()).toEqual(['c1', 'c2']);
    expect(keys.place_ids.sort()).toEqual([PLACE_A, PLACE_B].sort());
  });

  it('returns empty arrays when the trip has no itinerary items', async () => {
    const sb = makeFakeSupabase({ itineraryKeys: [], bookmarks: [] });
    const keys = await getTripPairingKeys(sb, { tripId: TRIP_ID });
    expect(keys.source_card_ids).toEqual([]);
    expect(keys.place_ids).toEqual([]);
  });
});

describe('getBookmarksWithPlannedFlag — B-038 canonical', () => {
  it('flags bookmark paired on source_card arm only', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [{ source_card_id: 'cardX', place_id: null }],
      bookmarks: [
        makeBookmarkRow({ id: BM_1, source_card_id: 'cardX', place_id: null }),
      ],
    });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });
    expect(out).toHaveLength(1);
    expect(out[0].planned).toBe(true);
    expect(out[0].source_card_id).toBe('cardX');
  });

  it('flags bookmark paired on place_id arm only', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [{ source_card_id: null, place_id: PLACE_A }],
      bookmarks: [
        makeBookmarkRow({ id: BM_1, source_card_id: null, place_id: PLACE_A }),
      ],
    });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });
    expect(out[0].planned).toBe(true);
  });

  it('flags bookmark when BOTH arms match', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [{ source_card_id: 'cardY', place_id: PLACE_A }],
      bookmarks: [
        makeBookmarkRow({
          id: BM_1,
          source_card_id: 'cardY',
          place_id: PLACE_A,
        }),
      ],
    });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });
    expect(out[0].planned).toBe(true);
  });

  it('does NOT flag when neither arm matches', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [{ source_card_id: 'cardZ', place_id: PLACE_B }],
      bookmarks: [
        makeBookmarkRow({
          id: BM_1,
          source_card_id: 'cardOther',
          place_id: PLACE_A,
        }),
      ],
    });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });
    expect(out[0].planned).toBe(false);
  });

  it('does NOT flag any bookmark when the trip has no itinerary items', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [],
      bookmarks: [
        makeBookmarkRow({ id: BM_1, source_card_id: 'c1', place_id: PLACE_A }),
        makeBookmarkRow({ id: BM_2, source_card_id: null, place_id: PLACE_B }),
      ],
    });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });
    expect(out.every((b) => b.planned === false)).toBe(true);
  });

  it('mixed set: correctly partitions planned vs not-planned', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [
        { source_card_id: 'cardA', place_id: null },
        { source_card_id: null, place_id: PLACE_A },
      ],
      bookmarks: [
        // BM_1 paired on source_card arm.
        makeBookmarkRow({ id: BM_1, source_card_id: 'cardA', place_id: null }),
        // BM_2 paired on place_id arm.
        makeBookmarkRow({ id: BM_2, source_card_id: null, place_id: PLACE_A }),
        // BM_3 not paired on either.
        makeBookmarkRow({ id: BM_3, source_card_id: 'cardZ', place_id: PLACE_B }),
        // BM_4 has both keys null — defensive, never paired.
        makeBookmarkRow({ id: BM_4, source_card_id: null, place_id: null }),
      ],
    });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });
    const byId = new Map(out.map((b) => [b.id, b]));
    expect(byId.get(BM_1)?.planned).toBe(true);
    expect(byId.get(BM_2)?.planned).toBe(true);
    expect(byId.get(BM_3)?.planned).toBe(false);
    expect(byId.get(BM_4)?.planned).toBe(false);
  });

  it('flag matches the canonical isPaired predicate (no drift)', async () => {
    const itineraryKeys: FakeItineraryKey[] = [
      { source_card_id: 'cardA', place_id: null },
      { source_card_id: null, place_id: PLACE_A },
    ];
    const bookmarks: FakeBookmarkRow[] = [
      makeBookmarkRow({ id: BM_1, source_card_id: 'cardA', place_id: null }),
      makeBookmarkRow({ id: BM_2, source_card_id: null, place_id: PLACE_A }),
      makeBookmarkRow({ id: BM_3, source_card_id: 'cardZ', place_id: PLACE_B }),
    ];
    const sb = makeFakeSupabase({ itineraryKeys, bookmarks });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });

    for (const b of out) {
      // Independent oracle: a bookmark is paired iff isPaired returns true
      // against *any* itinerary key. This is the same rule that powers the
      // PostgREST `.or(buildPairingOrClause(...))` clause in B-031.
      const oracle = itineraryKeys.some((ii) =>
        isPaired(
          { place_id: b.place_id, source_card_id: b.source_card_id },
          ii,
        ),
      );
      expect(b.planned).toBe(oracle);
    }
  });

  it('B-031 ↔ B-038 contract: getPairedBookmarkIdsForDay agrees with getBookmarksWithPlannedFlag for the day-bucket bookmarks', async () => {
    // Property-style: build a single bookmark+item universe; assert that the
    // ids B-031 returns for the day are a subset of the ids B-038 flags
    // planned=true for the trip — and that for every id B-031 returns, B-038
    // marks it planned. If either helper drifts from `isPaired`, this fails.
    //
    // Day-scoped fakes mock TWO `from('itinerary_items')` calls (one for
    // getDayPairingKeys, one for the bookmarks-id probe), then resolve the
    // bookmarks read. The trip-scoped helper similarly does two RTs but the
    // simple fake here ignores filters and returns the same dataset to both
    // — equivalent because we put every itinerary item on the same day.
    const itineraryKeys: FakeItineraryKey[] = [
      { source_card_id: 'cardA', place_id: null },
      { source_card_id: null, place_id: PLACE_A },
    ];
    const bookmarks: FakeBookmarkRow[] = [
      // Paired on card arm.
      makeBookmarkRow({ id: BM_1, source_card_id: 'cardA', place_id: null }),
      // Paired on place arm.
      makeBookmarkRow({ id: BM_2, source_card_id: null, place_id: PLACE_A }),
      // Not paired.
      makeBookmarkRow({ id: BM_3, source_card_id: 'cardZ', place_id: PLACE_B }),
      // Defensive double-null — never paired.
      makeBookmarkRow({ id: BM_4, source_card_id: null, place_id: null }),
    ];

    // Day-scoped fake: returns itinerary keys, then bookmarks (id-only)
    // matching the OR clause. We build a minimal subset chain that mirrors
    // PostgREST behaviour for the .or(buildPairingOrClause) call.
    function buildDayFake(): SupabaseClient {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supa: any = {
        from(table: string) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chain: any = {};
          let orClause: string | null = null;
          chain.select = () => chain;
          chain.eq = () => chain;
          chain.or = (clause: string) => {
            orClause = clause;
            return chain;
          };
          chain.limit = async () => {
            if (table === 'itinerary_items') {
              return { data: itineraryKeys, error: null };
            }
            if (table === 'bookmarks') {
              // Parse the OR clause and apply it to the bookmark set so the
              // returned ids match the canonical OR rule.
              const arms: Array<(b: FakeBookmarkRow) => boolean> = [];
              if (orClause) {
                const re = /(source_card_id|place_id)\.in\.\(([^)]*)\)/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(orClause)) !== null) {
                  const col = m[1] as 'source_card_id' | 'place_id';
                  const vals = m[2]
                    .split(',')
                    .map((v) => v.trim().replace(/^"|"$/g, ''));
                  arms.push((b) => {
                    const cell = b[col];
                    return cell !== null && vals.includes(cell);
                  });
                }
              }
              const filtered = bookmarks
                .filter((b) => arms.some((arm) => arm(b)))
                .map((b) => ({ id: b.id }));
              return { data: filtered, error: null };
            }
            return { data: [], error: null };
          };
          return chain;
        },
      };
      return supa as SupabaseClient;
    }

    const dayIds = await getPairedBookmarkIdsForDay(buildDayFake(), {
      tripId: TRIP_ID,
      dayId: '00000000-0000-4000-8000-00000000d001',
    });

    const tripOut = await getBookmarksWithPlannedFlag(
      makeFakeSupabase({ itineraryKeys, bookmarks }),
      { tripId: TRIP_ID },
    );
    const tripPlannedIds = new Set(
      tripOut.filter((b) => b.planned).map((b) => b.id),
    );

    // Contract: every id returned by B-031 must be marked planned by B-038
    // (since they consume the same itinerary set + the same predicate).
    for (const id of dayIds) {
      expect(tripPlannedIds.has(id)).toBe(true);
    }
    // And in this setup the converse also holds: every planned bookmark is
    // in the day-bucket because every itinerary item lives on the one day.
    expect(new Set(dayIds)).toEqual(tripPlannedIds);
  });

  it('preserves the flattened place join from the embedded select', async () => {
    const sb = makeFakeSupabase({
      itineraryKeys: [],
      bookmarks: [
        makeBookmarkRow({
          id: BM_1,
          place: {
            name: 'Sushi Saito',
            formatted_address: '1-1 Roppongi',
            category: 'restaurant',
            lat: 35.66,
            lng: 139.73,
          },
        }),
      ],
    });
    const out = await getBookmarksWithPlannedFlag(sb, { tripId: TRIP_ID });
    expect(out[0].place?.name).toBe('Sushi Saito');
  });
});
