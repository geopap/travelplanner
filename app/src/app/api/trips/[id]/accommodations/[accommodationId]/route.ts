import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import {
  ACCOMMODATION_SELECT,
  AccommodationPatch,
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

type RouteCtx = {
  params: Promise<{ id: string; accommodationId: string }>;
};

/** GET single accommodation. Viewer+. */
export async function GET(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, accommodationId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(accommodationId).success) return notFound();

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

    const { data, error } = await supabase
      .from('accommodations')
      .select(ACCOMMODATION_SELECT)
      .eq('id', accommodationId)
      .eq('trip_id', tripId)
      .maybeSingle();

    if (error) return serverError();
    if (!data) return notFound();

    const parsed = AccommodationRowSchema.safeParse(data);
    if (!parsed.success) return serverError();

    return NextResponse.json({
      accommodation: mapAccommodationRow(parsed.data),
    });
  } catch {
    return serverError();
  }
}

/** PATCH partial update. Editor+. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, accommodationId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(accommodationId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // Verify the accommodation belongs to the URL's trip (defense-in-depth).
    const { data: existing, error: existingErr } = await supabase
      .from('accommodations')
      .select(
        'id, trip_id, place_id, hotel_name, check_in_date, check_out_date, cost_per_night, total_cost, currency',
      )
      .eq('id', accommodationId)
      .maybeSingle();
    if (existingErr) return serverError();
    if (!existing || existing.trip_id !== tripId) return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = AccommodationPatch.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Cross-field constraints across PATCH + existing — re-check under merge.
    const merged = {
      place_id: input.place_id ?? existing.place_id ?? undefined,
      hotel_name: input.hotel_name ?? existing.hotel_name ?? undefined,
      check_in_date: input.check_in_date ?? existing.check_in_date,
      check_out_date: input.check_out_date ?? existing.check_out_date,
      cost_per_night:
        input.cost_per_night ?? existing.cost_per_night ?? null,
      total_cost: input.total_cost ?? existing.total_cost ?? null,
      currency: input.currency ?? existing.currency ?? null,
    };

    if (!merged.place_id && !merged.hotel_name) {
      return errorResponse(
        'validation_error',
        'Either hotel_name or place_id must remain set',
        400,
        { fieldErrors: { hotel_name: ['hotel_name or place_id required'] } },
      );
    }
    if (merged.check_out_date < merged.check_in_date) {
      return errorResponse(
        'accommodation_dates_invalid',
        'check_out_date must be on or after check_in_date',
        400,
      );
    }
    if (
      (merged.cost_per_night != null || merged.total_cost != null) &&
      !merged.currency
    ) {
      return errorResponse(
        'accommodation_cost_currency_required',
        'currency is required when a cost field is provided',
        400,
      );
    }

    // Trip-range pre-check when dates are in the patch.
    if (input.check_in_date != null || input.check_out_date != null) {
      const { data: tripRow, error: tripErr } = await supabase
        .from('trips')
        .select('start_date, end_date')
        .eq('id', tripId)
        .maybeSingle();
      if (tripErr) return serverError();
      if (!tripRow) return notFound();
      if (
        merged.check_in_date < tripRow.start_date ||
        merged.check_in_date > tripRow.end_date ||
        merged.check_out_date < tripRow.start_date ||
        merged.check_out_date > tripRow.end_date
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
    }

    // Verify a newly-supplied place_id resolves.
    if (input.place_id !== undefined && input.place_id !== null) {
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

    // Build sparse update — only include keys actually present in the input.
    const patch: Record<string, unknown> = {};
    if (input.place_id !== undefined) patch.place_id = input.place_id;
    if (input.hotel_name !== undefined) patch.hotel_name = input.hotel_name;
    if (input.check_in_date !== undefined)
      patch.check_in_date = input.check_in_date;
    if (input.check_out_date !== undefined)
      patch.check_out_date = input.check_out_date;
    if (input.confirmation !== undefined) patch.confirmation = input.confirmation;
    if (input.cost_per_night !== undefined)
      patch.cost_per_night = input.cost_per_night;
    if (input.total_cost !== undefined) patch.total_cost = input.total_cost;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.notes !== undefined) patch.notes = input.notes;

    const { data: updated, error: updateErr } = await supabase
      .from('accommodations')
      .update(patch)
      .eq('id', accommodationId)
      .eq('trip_id', tripId)
      .select(ACCOMMODATION_SELECT)
      .single();

    if (updateErr) {
      const msg = updateErr.message ?? '';
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
      if (msg.includes('accommodations_name_or_place')) {
        return errorResponse(
          'validation_error',
          'Either hotel_name or place_id must remain set',
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

    if (!updated) return serverError();

    const updatedParsed = AccommodationRowSchema.safeParse(updated);
    if (!updatedParsed.success) return serverError();

    await logAudit({
      actorId: userId,
      action: 'accommodation_updated',
      entity: 'accommodations',
      entityId: accommodationId,
      tripId,
      metadata: {
        fields: Object.keys(patch),
        has_place_link: updatedParsed.data.place_id !== null,
        has_hotel_name: updatedParsed.data.hotel_name !== null,
        has_confirmation: updatedParsed.data.confirmation !== null,
        check_in_date: updatedParsed.data.check_in_date,
        check_out_date: updatedParsed.data.check_out_date,
      },
    });

    return NextResponse.json({
      accommodation: mapAccommodationRow(updatedParsed.data),
    });
  } catch {
    return serverError();
  }
}

/** DELETE accommodation. Editor+. */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, accommodationId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(accommodationId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const { data: existing, error: existingErr } = await supabase
      .from('accommodations')
      .select(
        'id, trip_id, place_id, hotel_name, confirmation, check_in_date, check_out_date',
      )
      .eq('id', accommodationId)
      .maybeSingle();
    if (existingErr) return serverError();
    if (!existing || existing.trip_id !== tripId) return notFound();

    const { error: deleteErr } = await supabase
      .from('accommodations')
      .delete()
      .eq('id', accommodationId)
      .eq('trip_id', tripId);
    if (deleteErr) return serverError();

    await logAudit({
      actorId: userId,
      action: 'accommodation_deleted',
      entity: 'accommodations',
      entityId: accommodationId,
      tripId,
      metadata: {
        has_place_link: existing.place_id !== null,
        has_hotel_name: existing.hotel_name !== null,
        has_confirmation: existing.confirmation !== null,
        check_in_date: existing.check_in_date,
        check_out_date: existing.check_out_date,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
