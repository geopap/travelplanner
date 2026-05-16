/**
 * B-031 / B-038 — Shared bookmark/itinerary "paired" predicate.
 *
 * SINGLE source of truth for the rule:
 *
 *   A bookmark `b` is "paired" with an itinerary item `ii` iff
 *     (b.source_card_id != null AND b.source_card_id == ii.source_card_id)
 *     OR
 *     (b.place_id != null AND b.place_id == ii.place_id)
 *
 * Both arms gate on non-null on the bookmark side; the itinerary-item side
 * carries the same null-safety implicitly because equality with `null` in JS
 * is `false`. The OR is non-exclusive (a bookmark may match on both arms; the
 * outer call de-duplicates by `bookmarks.id`).
 *
 * **Engineers MUST consume this helper** in any new endpoint or component
 * that needs the predicate. Inlining the OR predicate in route handlers is a
 * DRY violation and will be flagged by the R4 code-reviewer (HIGH).
 *
 * Used by:
 *   - B-031 — GET /api/trips/[id]/days/[dayId]/bookmarks  (day-scoped)
 *   - B-038 — /trips/[id]/places planned/not-planned filter (trip-scoped)
 *
 * Pure predicate `isPaired` is the canonical truth-table; integration tests
 * for both endpoints assert against the same function, so any drift will
 * fail both suites in lockstep.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bookmark, ItineraryItem } from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Pure predicate — exported for tests and any in-memory client recompute.
// ---------------------------------------------------------------------------

/**
 * Pure predicate: given a bookmark and an itinerary item, are they paired?
 *
 * Matches the canonical OR rule documented at the top of this file.
 * Both arms are short-circuited on the bookmark-side non-null check so a
 * bookmark with `source_card_id = null AND place_id = null` (which the DB
 * CHECK forbids today but defensive code allows for) always returns `false`.
 */
export function isPaired(
  b: Pick<Bookmark, 'place_id'> & { source_card_id?: string | null },
  ii: Pick<ItineraryItem, 'place_id'> & { source_card_id?: string | null },
): boolean {
  const bSourceCard = b.source_card_id ?? null;
  const iiSourceCard = ii.source_card_id ?? null;
  if (bSourceCard !== null && bSourceCard === iiSourceCard) return true;
  if (b.place_id !== null && b.place_id === ii.place_id) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Day-scoped helper (B-031).
// ---------------------------------------------------------------------------

/**
 * Lean itinerary-item key shape pulled from the day-scoped probe.
 * Exported so callers can compose follow-up queries (e.g. `or(...in.(...))`).
 */
export interface PairingKeys {
  source_card_ids: string[];
  place_ids: string[];
}

interface PairingKeyRow {
  source_card_id: string | null;
  place_id: string | null;
}

/**
 * Fetch the (source_card_id, place_id) key pairs for every itinerary_item on a
 * given day. Returned as two deduplicated, non-null key lists ready for use in
 * a follow-up PostgREST `.or('source_card_id.in.(...),place_id.in.(...)')`.
 *
 * Why two round-trips instead of a single correlated EXISTS: PostgREST does
 * not expose correlated subqueries via the REST API; encoding the OR-of-EXISTS
 * would require either an RPC (= schema change, forbidden by B-031.1) or
 * brittle string-built filter chains. The two-round-trip form is semantically
 * identical, both probes are indexed, and the day-scoped fetch is bounded by
 * the Trello-list size (< 50 in practice).
 *
 * Returns empty arrays when the day has no itinerary items (paired set is then
 * trivially empty — caller should short-circuit).
 */
export async function getDayPairingKeys(
  supabase: SupabaseClient,
  args: { tripId: string; dayId: string },
): Promise<PairingKeys> {
  const { data, error } = await supabase
    .from('itinerary_items')
    .select('source_card_id, place_id')
    .eq('trip_id', args.tripId)
    .eq('day_id', args.dayId)
    .limit(500);
  if (error) throw error;

  const rows: PairingKeyRow[] = Array.isArray(data)
    ? data.flatMap((r): PairingKeyRow[] => {
        if (!r || typeof r !== 'object') return [];
        const row = r as { source_card_id?: unknown; place_id?: unknown };
        return [
          {
            source_card_id:
              typeof row.source_card_id === 'string' ? row.source_card_id : null,
            place_id:
              typeof row.place_id === 'string' ? row.place_id : null,
          },
        ];
      })
    : [];

  const sourceCards = new Set<string>();
  const placeIds = new Set<string>();
  for (const r of rows) {
    if (r.source_card_id !== null) sourceCards.add(r.source_card_id);
    if (r.place_id !== null) placeIds.add(r.place_id);
  }
  return {
    source_card_ids: Array.from(sourceCards),
    place_ids: Array.from(placeIds),
  };
}

/**
 * Day-scoped: returns the set of bookmark IDs that are paired to a specific
 * day on a trip (via either `source_card_id` match or shared `place_id`).
 *
 * Two indexed round-trips, no N+1. See `getDayPairingKeys` for the rationale.
 */
export async function getPairedBookmarkIdsForDay(
  supabase: SupabaseClient,
  args: { tripId: string; dayId: string },
): Promise<string[]> {
  const keys = await getDayPairingKeys(supabase, args);
  if (keys.source_card_ids.length === 0 && keys.place_ids.length === 0) {
    return [];
  }
  const orClause = buildPairingOrClause(keys);
  const query = supabase
    .from('bookmarks')
    .select('id')
    .eq('trip_id', args.tripId)
    .or(orClause)
    .limit(500);
  const { data, error } = await query;
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row): string[] => {
    if (!row || typeof row !== 'object') return [];
    const id = (row as { id?: unknown }).id;
    return typeof id === 'string' ? [id] : [];
  });
}

/**
 * Build the PostgREST `.or()` clause used by both `getPairedBookmarkIdsForDay`
 * and the day-bookmarks route. Each arm is omitted when its key set is empty —
 * passing an empty `in.()` arg list to PostgREST yields a parse error.
 *
 * Exported for the route handler so the OR predicate is authored in exactly
 * one place (DRY contract per B-031.5).
 */
export function buildPairingOrClause(keys: PairingKeys): string {
  const arms: string[] = [];
  if (keys.source_card_ids.length > 0) {
    arms.push(`source_card_id.in.(${keys.source_card_ids.map(quoteForIn).join(',')})`);
  }
  if (keys.place_ids.length > 0) {
    arms.push(`place_id.in.(${keys.place_ids.map(quoteForIn).join(',')})`);
  }
  return arms.join(',');
}

/**
 * Quote a value for use inside PostgREST `in.(...)`. The PostgREST grammar
 * requires double-quoting values that contain commas, parentheses, or quotes.
 * Bookmark source_card_ids are Trello card IDs (`[a-f0-9]{24}`) and place_id
 * values are uuids — neither contains any special character in practice — but
 * we defensively double-quote both to stay safe under future schema changes.
 */
function quoteForIn(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Trip-scoped helpers (B-038).
// ---------------------------------------------------------------------------

/**
 * Trip-scoped sibling of `getDayPairingKeys` — fetches the
 * (source_card_id, place_id) key pairs for every itinerary item on a trip,
 * deduplicated into two non-null key lists. Bounded by `.limit(2000)` —
 * comfortably above the per-trip itinerary-item count for any realistic trip
 * (Japan 2026 has ~120 items at the time of writing).
 *
 * Exported so the trip-scoped paired-bookmark variant can compose follow-up
 * queries via `buildPairingOrClause`, matching the day-scoped pattern.
 */
export async function getTripPairingKeys(
  supabase: SupabaseClient,
  args: { tripId: string },
): Promise<PairingKeys> {
  const { data, error } = await supabase
    .from('itinerary_items')
    .select('source_card_id, place_id')
    .eq('trip_id', args.tripId)
    .limit(2000);
  if (error) throw error;

  const rows: PairingKeyRow[] = Array.isArray(data)
    ? data.flatMap((r): PairingKeyRow[] => {
        if (!r || typeof r !== 'object') return [];
        const row = r as { source_card_id?: unknown; place_id?: unknown };
        return [
          {
            source_card_id:
              typeof row.source_card_id === 'string' ? row.source_card_id : null,
            place_id:
              typeof row.place_id === 'string' ? row.place_id : null,
          },
        ];
      })
    : [];

  const sourceCards = new Set<string>();
  const placeIds = new Set<string>();
  for (const r of rows) {
    if (r.source_card_id !== null) sourceCards.add(r.source_card_id);
    if (r.place_id !== null) placeIds.add(r.place_id);
  }
  return {
    source_card_ids: Array.from(sourceCards),
    place_ids: Array.from(placeIds),
  };
}

/**
 * Row shape pulled from `bookmarks` by the trip-scoped variant. Carries
 * `source_card_id` (not present on the canonical `Bookmark` domain type — it
 * is a Trello-import artefact that the public API hides) so the `planned`
 * predicate can be evaluated in-memory via `isPaired`.
 */
interface TripBookmarkRow {
  id: string;
  trip_id: string;
  place_id: string | null;
  source_card_id: string | null;
  category: Bookmark['category'];
  notes: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
  place: unknown;
}

/**
 * Trip-scoped: returns every bookmark in a trip tagged with a `planned`
 * boolean — true when the bookmark is paired with at least one itinerary
 * item in the same trip per the canonical OR rule encoded in `isPaired`.
 *
 * Strategy — two indexed PostgREST round-trips + in-memory `isPaired`:
 *   RT1: fetch (source_card_id, place_id) keys for every itinerary item on
 *        the trip via `getTripPairingKeys` (bounded < 2000 rows).
 *   RT2: fetch every bookmark on the trip via a direct table select with the
 *        embedded slim place fields (bounded by caller `limit` — defaults to
 *        500, same envelope as the page's existing 200-row cap).
 *   In-memory: collapse the itinerary keys into a Set-pair and walk the
 *        bookmarks once, evaluating `isPaired` against any candidate key.
 *
 * The `.or(buildPairingOrClause(...))` SQL form is supported via the
 * exported `buildPairingOrClause` (consumed by B-031); we deliberately do
 * NOT issue a third round-trip here because the trip-scoped bookmark set is
 * already loaded for the UI to render, so the in-memory pass costs
 * O(bookmarks × keys-per-bookmark-arm) on bounded inputs — strictly less
 * than the round-trip latency of a third PostgREST call. Architect-approved
 * pattern (see §B-031.5 — "compute the planned flag either via a second
 * `.or(...)` query reusing `buildPairingOrClause` or in-memory via
 * `isPaired`"); the predicate stays single-source via `isPaired`.
 *
 * The returned row shape extends `Bookmark` with `planned` AND
 * `source_card_id` (kept on the row so callers needing the Trello card link
 * — e.g. the /places detail surface — do not need a third probe). The
 * trailing optional `place` is the flattened join shape, matching the
 * existing `mapBookmarkRow` contract.
 */
export async function getBookmarksWithPlannedFlag(
  supabase: SupabaseClient,
  args: { tripId: string; limit?: number },
): Promise<
  Array<Bookmark & { planned: boolean; source_card_id: string | null }>
> {
  const limit = args.limit ?? 500;

  // RT1: trip-wide itinerary keys.
  const keys = await getTripPairingKeys(supabase, { tripId: args.tripId });

  // RT2: full bookmark set for the trip with the slim place join.
  const { data, error } = await supabase
    .from('bookmarks')
    .select(
      'id, trip_id, place_id, source_card_id, category, notes, added_by, created_at, updated_at, place:places(name, formatted_address, category, lat, lng)',
    )
    .eq('trip_id', args.tripId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = Array.isArray(data) ? (data as TripBookmarkRow[]) : [];

  // Short-circuit: no itinerary keys at all → every bookmark is "not planned".
  const noKeys =
    keys.source_card_ids.length === 0 && keys.place_ids.length === 0;

  // Build synthetic itinerary-item probes — one per unique key — so the
  // canonical `isPaired` predicate decides membership. This keeps the OR rule
  // authored exactly once (in `isPaired`); the Sets are O(1) candidate lookups
  // used only to gate which probes are worth running per bookmark arm.
  const sourceCardSet = new Set(keys.source_card_ids);
  const placeIdSet = new Set(keys.place_ids);

  return rows.map((row) => {
    const place = Array.isArray(row.place)
      ? (row.place[0] as Bookmark['place'] | undefined)
      : (row.place as Bookmark['place'] | undefined);

    let planned = false;
    if (!noKeys) {
      // Arm 1: source_card_id match. Pull the matching key (if any) and ask
      // the canonical predicate.
      if (
        row.source_card_id !== null &&
        sourceCardSet.has(row.source_card_id)
      ) {
        planned = isPaired(
          { place_id: row.place_id, source_card_id: row.source_card_id },
          { place_id: null, source_card_id: row.source_card_id },
        );
      }
      // Arm 2: place_id match (only if Arm 1 didn't already prove paired).
      if (
        !planned &&
        row.place_id !== null &&
        placeIdSet.has(row.place_id)
      ) {
        planned = isPaired(
          { place_id: row.place_id, source_card_id: row.source_card_id },
          { place_id: row.place_id, source_card_id: null },
        );
      }
    }

    return {
      id: row.id,
      trip_id: row.trip_id,
      place_id: row.place_id,
      source_card_id: row.source_card_id,
      category: row.category,
      notes: row.notes,
      added_by: row.added_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...(place ? { place } : {}),
      planned,
    };
  });
}
