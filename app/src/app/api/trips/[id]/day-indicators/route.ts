import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import { AccommodationIndicatorRowSchema } from '@/lib/validations/accommodations';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/trips/[id]/day-indicators
 *
 * Returns every per-day accommodation indicator (Check in / Staying at /
 * Check out / same-day) for every day of the trip in a single batched query.
 *
 * Decision (architect §B-008.4): standalone endpoint backed by the
 * `trip_day_accommodation_indicators` view (security_invoker=true). The
 * frontend groups by `trip_day_id` client-side to render badges. This is
 * a single SELECT — no N+1 — regardless of trip length or accommodation
 * count.
 *
 * Viewer+ access; RLS on the underlying tables enforces isolation.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // Defensive row cap. Single-shot endpoint by design (no pagination — the
    // frontend renders all per-day badges at once). A trip with N days and M
    // active accommodations per day produces at most N*M rows; in practice
    // far below the cap. If we ever hit the ceiling we log a warn so it can
    // be promoted to true pagination.
    const ROW_CAP = 1000;
    const { data, error } = await supabase
      .from('trip_day_accommodation_indicators')
      .select(
        'trip_id, trip_day_id, day_date, accommodation_id, hotel_name, place_id, indicator_type',
      )
      .eq('trip_id', id)
      .limit(ROW_CAP);

    if (error) return serverError();

    const parsed = AccommodationIndicatorRowSchema.array().safeParse(
      data ?? [],
    );
    if (!parsed.success) return serverError();

    if (parsed.data.length >= ROW_CAP) {
      console.warn(
        JSON.stringify({
          level: 'route_warn',
          route: 'day_indicators_get',
          msg: 'row_cap_reached',
          trip_id: id,
          cap: ROW_CAP,
        }),
      );
    }

    return NextResponse.json({ indicators: parsed.data });
  } catch {
    return serverError();
  }
}
