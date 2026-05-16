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
import { computeIndicatorType } from '@/lib/utils/accommodation-indicators';
import type {
  AccommodationMapMarker,
  DayMapItineraryItem,
  DayMapResponse,
} from '@/lib/types/accommodations';

type RouteCtx = { params: Promise<{ id: string; dayId: string }> };

// ---------------------------------------------------------------------------
// Row schemas — validate Supabase response shapes without unsafe casts.
// ---------------------------------------------------------------------------

const PlaceEmbedSchema = z
  .object({
    id: z.string().uuid(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    name: z.string(),
  })
  .nullable();

// PostgREST may embed a single FK as object or single-element array; accept both.
const PlaceEmbedFlexibleSchema = z.union([
  PlaceEmbedSchema,
  z.array(PlaceEmbedSchema.unwrap()),
]);

const ItineraryItemMapRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: z.string(),
  start_time: z.string().nullable(),
  place: PlaceEmbedFlexibleSchema.nullish(),
});

const AccommodationMapRowSchema = z.object({
  id: z.string().uuid(),
  hotel_name: z.string().nullable(),
  check_in_date: z.string(),
  check_out_date: z.string(),
  place: PlaceEmbedFlexibleSchema.nullish(),
});

/** Flatten PostgREST FK embed (object | single-element array) to a single object or null. */
function flattenPlace(
  embed: unknown,
): { id: string; lat: number; lng: number; name: string } | null {
  let candidate: unknown = embed;
  if (Array.isArray(candidate)) {
    candidate = candidate[0] ?? null;
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const row = candidate as {
    id: unknown;
    lat: unknown;
    lng: unknown;
    name: unknown;
  };
  if (
    typeof row.id !== 'string' ||
    typeof row.name !== 'string' ||
    typeof row.lat !== 'number' ||
    typeof row.lng !== 'number'
  ) {
    return null;
  }
  return { id: row.id, lat: row.lat, lng: row.lng, name: row.name };
}

/**
 * GET /api/trips/[id]/days/[dayId]/map
 *
 * B-023 — Day-scoped map data. Single round-trip:
 *  1. Look up the day to confirm trip ownership and grab `date`.
 *  2. Promise.all of two SELECTs (items + accommodations) with FK embed of `places`.
 *  3. Filter items to those with a plottable place; filter accommodations to
 *     non-null place_id (DB SELECT already pre-filters); compute `indicator_type`.
 *
 * Perf budget: <500ms P95 — two parallel queries against indexed columns,
 * no N+1.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, dayId } = await ctx.params;
    // Malformed UUIDs return 404 (existence-hiding).
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(dayId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, tripId, auth.user.id, 'viewer');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // 1. Look up the day; confirm it belongs to the trip.
    const { data: dayRow, error: dayErr } = await supabase
      .from('trip_days')
      .select('id, date')
      .eq('id', dayId)
      .eq('trip_id', tripId)
      .maybeSingle<{ id: string; date: string }>();
    if (dayErr) return serverError();
    if (!dayRow) return notFound();

    const dayDate = dayRow.date;

    // 2. Two parallel SELECTs.
    const [itemsRes, accomRes] = await Promise.all([
      supabase
        .from('itinerary_items')
        .select(
          'id, title, type, start_time, place:places!itinerary_items_place_id_fkey(id, lat, lng, name)',
        )
        .eq('trip_id', tripId)
        .eq('day_id', dayId)
        .order('start_time', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(200),
      supabase
        .from('accommodations')
        .select(
          'id, hotel_name, check_in_date, check_out_date, place:places!accommodations_place_id_fkey(id, lat, lng, name)',
        )
        .eq('trip_id', tripId)
        .lte('check_in_date', dayDate)
        .gte('check_out_date', dayDate)
        .not('place_id', 'is', null)
        .order('check_in_date', { ascending: true })
        .limit(50),
    ]);

    if (itemsRes.error || accomRes.error) return serverError();

    const itemsParsed = ItineraryItemMapRowSchema.array().safeParse(
      itemsRes.data ?? [],
    );
    const accomParsed = AccommodationMapRowSchema.array().safeParse(
      accomRes.data ?? [],
    );
    if (!itemsParsed.success || !accomParsed.success) return serverError();

    // 3. Normalize items (place may be null or have null coords — drop coords).
    const items: DayMapItineraryItem[] = itemsParsed.data.map((row) => {
      const place = flattenPlace(row.place);
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        start_time: row.start_time,
        place,
      };
    });

    // 4. Normalize accommodations: drop any with no plottable place; compute
    // indicator_type. The SELECT's `place_id IS NOT NULL` predicate handles
    // the common case; rows whose embedded `place` happens to have null
    // coords are dropped here defensively (consistent with items invariant).
    const accommodations: AccommodationMapMarker[] = [];
    for (const row of accomParsed.data) {
      const place = flattenPlace(row.place);
      if (!place) continue;
      const indicator_type = computeIndicatorType({
        check_in_date: row.check_in_date,
        check_out_date: row.check_out_date,
        day_date: dayDate,
      });
      accommodations.push({
        accommodation_id: row.id,
        // Coalesce: hotel_name preferred, fall back to place name (DB CHECK
        // guarantees at least one is non-null).
        hotel_name: row.hotel_name ?? place.name,
        check_in_date: row.check_in_date,
        check_out_date: row.check_out_date,
        indicator_type,
        place,
      });
    }

    const body: DayMapResponse = { items, accommodations };
    return NextResponse.json(body);
  } catch {
    return serverError();
  }
}
