import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import {
  ACCOMMODATION_SELECT,
  AccommodationCreate,
  AccommodationListQuery,
  AccommodationRowSchema,
  mapAccommodationRow,
} from '@/lib/validations/accommodations';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { logAudit } from '@/lib/audit';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/trips/[id]/accommodations
 *
 * Lists accommodations for a trip the caller can view.
 * - Order: check_in_date ASC, id ASC (stable; uses accommodations_trip_dates_idx).
 * - Pagination: page (default 1) / limit (default 20, max 100).
 * - Single foreign-table join into `places` for slim attached data — no N+1.
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
    const parsed = AccommodationListQuery.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return errorResponse('invalid_query', 'Invalid query', 400, {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const { page, limit } = parsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from('accommodations')
      .select(ACCOMMODATION_SELECT, { count: 'exact' })
      .eq('trip_id', id)
      .order('check_in_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) return serverError();

    const rowsParsed = AccommodationRowSchema.array().safeParse(data ?? []);
    if (!rowsParsed.success) return serverError();

    return NextResponse.json({
      items: rowsParsed.data.map(mapAccommodationRow),
      page,
      limit,
      total: count ?? 0,
    });
  } catch {
    return serverError();
  }
}

/**
 * POST /api/trips/[id]/accommodations
 *
 * Creates a new accommodation. Editor+ only. Defense-in-depth checks:
 * - Body validated via Zod (schema enforces name-or-place, date order,
 *   cost↔currency pairing).
 * - Trip dates pre-checked here for nicer error messages, then re-validated
 *   by the DB trigger `tg_accommodation_within_trip` (authoritative).
 * - Optional `place_id` is verified against `places` (400 if missing).
 */
export async function POST(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, id, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = AccommodationCreate.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Pre-flight trip-range check (defense-in-depth + nicer error than the
    // raw trigger exception). The DB trigger remains authoritative.
    const { data: tripRow, error: tripErr } = await supabase
      .from('trips')
      .select('start_date, end_date')
      .eq('id', id)
      .maybeSingle();
    if (tripErr) return serverError();
    if (!tripRow) return notFound();

    if (
      input.check_in_date < tripRow.start_date ||
      input.check_in_date > tripRow.end_date ||
      input.check_out_date < tripRow.start_date ||
      input.check_out_date > tripRow.end_date
    ) {
      return errorResponse(
        'accommodation_dates_outside_trip',
        'Check-in/check-out dates must fall within the trip date range',
        400,
        {
          trip_start_date: tripRow.start_date,
          trip_end_date: tripRow.end_date,
        },
      );
    }

    // Verify optional place_id exists.
    if (input.place_id) {
      const { data: placeRow, error: placeErr } = await supabase
        .from('places')
        .select('id')
        .eq('id', input.place_id)
        .maybeSingle();
      if (placeErr) return serverError();
      if (!placeRow) {
        return errorResponse('place_not_found', 'Place not found', 400);
      }
    }

    const insertPayload = {
      trip_id: id,
      place_id: input.place_id ?? null,
      hotel_name: input.hotel_name ?? null,
      check_in_date: input.check_in_date,
      check_out_date: input.check_out_date,
      confirmation: input.confirmation ?? null,
      cost_per_night: input.cost_per_night ?? null,
      total_cost: input.total_cost ?? null,
      currency: input.currency ?? null,
      notes: input.notes ?? null,
      created_by: userId,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('accommodations')
      .insert(insertPayload)
      .select(ACCOMMODATION_SELECT)
      .single();

    if (insertErr) {
      // Map the trip-range trigger errors back into 400s.
      const msg = insertErr.message ?? '';
      if (
        msg.includes('check_in_out_of_range') ||
        msg.includes('check_out_out_of_range')
      ) {
        return errorResponse(
          'accommodation_dates_outside_trip',
          'Check-in/check-out dates must fall within the trip date range',
          400,
        );
      }
      if (msg.includes('accommodations_dates_valid')) {
        return errorResponse(
          'accommodation_dates_invalid',
          'check_out_date must be on or after check_in_date',
          400,
        );
      }
      if (msg.includes('accommodations_cost_currency_paired')) {
        return errorResponse(
          'accommodation_cost_currency_required',
          'currency is required when a cost field is provided',
          400,
        );
      }
      return serverError();
    }

    if (!inserted) return serverError();

    const insertedParsed = AccommodationRowSchema.safeParse(inserted);
    if (!insertedParsed.success) return serverError();

    await logAudit({
      actorId: userId,
      action: 'accommodation_created',
      entity: 'accommodations',
      entityId: insertedParsed.data.id,
      tripId: id,
      metadata: {
        has_place_link: insertedParsed.data.place_id !== null,
        has_hotel_name: insertedParsed.data.hotel_name !== null,
        has_confirmation: insertedParsed.data.confirmation !== null,
        check_in_date: insertedParsed.data.check_in_date,
        check_out_date: insertedParsed.data.check_out_date,
      },
    });

    return NextResponse.json(
      { accommodation: mapAccommodationRow(insertedParsed.data) },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}
