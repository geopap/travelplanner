import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { PageSchema, UuidSchema } from '@/lib/validations/common';
import { TransportationListRowSchema } from '@/lib/validations/transportation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import type { TransportationWithItem } from '@/lib/types/transportation';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/trips/[id]/transportation
 *
 * Lists every transportation segment for a trip the caller can view.
 * Ordered by `departure_time ASC NULLS LAST, id ASC` (stable). Uses the
 * (trip_id, departure_time NULLS LAST) index — no N+1, single-query
 * foreign-table join into `itinerary_items` for the day_id/title columns.
 *
 * Pagination: `page` default 1, `limit` default 20 (max 100) — shared
 * `PageSchema`. Membership enforced server-side; trip_id never trusted
 * from the body.
 */
export async function GET(
  request: NextRequest,
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

    const url = new URL(request.url);
    const pageParsed = PageSchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!pageParsed.success) {
      return errorResponse('invalid_query', 'Invalid query', 400, {
        fieldErrors: pageParsed.error.flatten().fieldErrors,
      });
    }
    const { page, limit } = pageParsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from('transportation')
      .select(
        'id, itinerary_item_id, trip_id, mode, carrier, confirmation, departure_location, arrival_location, departure_time, arrival_time, cost, currency, notes, created_by, created_at, updated_at, item:itinerary_items!inner(id, day_id, title)',
        { count: 'exact' },
      )
      .eq('trip_id', id)
      .order('departure_time', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) return serverError();

    // Validate every row via Zod, then flatten Supabase's join shape (the
    // joined `item` may arrive as either a single object or a single-element
    // array depending on relationship metadata).
    const rowsParsed = TransportationListRowSchema.array().safeParse(data ?? []);
    if (!rowsParsed.success) return serverError();
    const items: TransportationWithItem[] = rowsParsed.data.map((row) => {
      const item = Array.isArray(row.item) ? row.item[0] : row.item;
      const { item: _omit, ...rest } = row;
      void _omit;
      return {
        ...rest,
        item: {
          id: item?.id ?? '',
          day_id: item?.day_id ?? null,
          title: item?.title ?? '',
        },
      };
    });

    return NextResponse.json({
      items,
      page,
      limit,
      total: count ?? 0,
    });
  } catch {
    return serverError();
  }
}
