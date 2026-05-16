/**
 * B-031 — GET /api/trips/[id]/days/[dayId]/bookmarks
 *
 * Returns the bookmarks "paired" to a given day on a trip via the canonical
 * `isPaired` rule (see `app/src/lib/bookmarks/pairing.ts`):
 *   - source_card_id match (Trello-card-derived pairing), OR
 *   - shared place_id (the same Google Place is on both the day's itinerary
 *     and in the trip's bookmark list).
 *
 * Two indexed round-trips, no N+1:
 *   1. Fetch the day-scoped (source_card_id, place_id) key set via
 *      `getDayPairingKeys` (uses `itinerary_items` PK + day_id index).
 *   2. Fetch `bookmarks` rows matching either key via the OR clause built in
 *      `buildPairingOrClause`, embedding the FK-joined `places` row.
 *
 * Perf budget: < 500ms P95. Auth: viewer-or-higher trip member (read-only).
 * 404 (existence-hiding) on non-members, malformed UUIDs, and day-not-on-trip.
 *
 * Pagination: NONE per AC 7 — day-bookmark count is bounded by Trello list
 * size (< 50 in practice). Defensive `.limit(200)` documents the upper bound.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { UuidSchema } from '@/lib/validations/common';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import {
  buildPairingOrClause,
  getDayPairingKeys,
} from '@/lib/bookmarks/pairing';
import type { BookmarkCategory } from '@/lib/types/domain';
import { BookmarkCategorySchema } from '@/lib/validations/bookmarks';

type RouteCtx = { params: Promise<{ id: string; dayId: string }> };

// ---------------------------------------------------------------------------
// Response contract (mirror of SOLUTION_DESIGN §B-031.3).
// ---------------------------------------------------------------------------

export interface DayBookmarkRow {
  id: string;
  source_card_id: string | null;
  place_id: string | null;
  category: BookmarkCategory;
  notes: string | null;
  place: {
    google_place_id: string;
    name: string;
    formatted_address: string | null;
  } | null;
}

export interface DayBookmarksResponse {
  bookmarks: DayBookmarkRow[];
}

// ---------------------------------------------------------------------------
// Row schemas — validate the Supabase response shape without unsafe casts.
// ---------------------------------------------------------------------------

const PlaceEmbedSchema = z
  .object({
    google_place_id: z.string(),
    name: z.string(),
    formatted_address: z.string().nullable(),
  })
  .nullable();

// PostgREST embeds a single FK relation as object or single-element array.
const PlaceEmbedFlexibleSchema = z.union([
  PlaceEmbedSchema,
  z.array(PlaceEmbedSchema.unwrap()),
]);

const BookmarkRowSchema = z.object({
  id: z.string().uuid(),
  source_card_id: z.string().nullable(),
  place_id: z.string().uuid().nullable(),
  category: BookmarkCategorySchema,
  notes: z.string().nullable(),
  place: PlaceEmbedFlexibleSchema.nullish(),
});

type PlaceShape = {
  google_place_id: string;
  name: string;
  formatted_address: string | null;
};

/** Flatten the PostgREST FK embed (object | single-element array | null). */
function flattenPlace(embed: unknown): PlaceShape | null {
  let candidate: unknown = embed;
  if (Array.isArray(candidate)) {
    candidate = candidate[0] ?? null;
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const row = candidate as {
    google_place_id?: unknown;
    name?: unknown;
    formatted_address?: unknown;
  };
  if (typeof row.google_place_id !== 'string' || typeof row.name !== 'string') {
    return null;
  }
  return {
    google_place_id: row.google_place_id,
    name: row.name,
    formatted_address:
      typeof row.formatted_address === 'string' ? row.formatted_address : null,
  };
}

/** Stable order for the response: place name (or fallback) alpha, then id. */
function sortKey(row: DayBookmarkRow): string {
  const name = row.place?.name ?? row.notes ?? '';
  return name.toLocaleLowerCase();
}

export async function GET(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, dayId } = await ctx.params;
    // Existence-hiding: malformed UUIDs return 404 (matches /days/[dayId]/map).
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(dayId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(
      supabase,
      tripId,
      auth.user.id,
      'viewer',
    );
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // 1. Confirm the day belongs to the trip (existence-hiding).
    const { data: dayRow, error: dayErr } = await supabase
      .from('trip_days')
      .select('id')
      .eq('id', dayId)
      .eq('trip_id', tripId)
      .maybeSingle<{ id: string }>();
    if (dayErr) return serverError();
    if (!dayRow) return notFound();

    // 2. Fetch the day's itinerary-item key set (round-trip 1).
    const keys = await getDayPairingKeys(supabase, { tripId, dayId });

    // Short-circuit when the day has no candidate keys at all — no bookmarks
    // can be paired, no need for round-trip 2.
    if (keys.source_card_ids.length === 0 && keys.place_ids.length === 0) {
      const empty: DayBookmarksResponse = { bookmarks: [] };
      return NextResponse.json(empty);
    }

    // 3. Fetch paired bookmarks with embedded place (round-trip 2).
    const orClause = buildPairingOrClause(keys);
    const { data, error } = await supabase
      .from('bookmarks')
      .select(
        'id, source_card_id, place_id, category, notes, place:places!bookmarks_place_id_fkey(google_place_id, name, formatted_address)',
      )
      .eq('trip_id', tripId)
      .or(orClause)
      .limit(200);
    if (error) return serverError();

    const parsed = BookmarkRowSchema.array().safeParse(data ?? []);
    if (!parsed.success) return serverError();

    const bookmarks: DayBookmarkRow[] = parsed.data.map((row) => ({
      id: row.id,
      source_card_id: row.source_card_id,
      place_id: row.place_id,
      category: row.category,
      notes: row.notes,
      place: flattenPlace(row.place),
    }));

    bookmarks.sort((a, b) => {
      const ka = sortKey(a);
      const kb = sortKey(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const body: DayBookmarksResponse = { bookmarks };
    return NextResponse.json(body);
  } catch {
    return serverError();
  }
}
