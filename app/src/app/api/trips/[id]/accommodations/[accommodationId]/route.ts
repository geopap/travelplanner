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
import { resolveGooglePlaceId } from '@/lib/supabase/place-resolver';

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

    // B-023: reject mixed identity payloads outright — the server can't tell
    // which the user meant. Acceptable combinations:
    //   - place_id: <uuid>             → set FK directly
    //   - place_id: null               → clear FK (must keep hotel_name)
    //   - google_place_id: <gpid>      → resolve to FK
    //   - google_place_id: null        → equivalent to no-op (ignored)
    if ('place_id' in input && 'google_place_id' in input) {
      // Two exceptions to reject: both non-null, or place_id:null + gpid set
      // (architect: "If both google_place_id and place_id: null are present,
      // reject with 400").
      const placeIdSent = input.place_id !== undefined;
      const gpidSent =
        input.google_place_id !== undefined && input.google_place_id !== null;
      if (placeIdSent && gpidSent) {
        return badRequest(
          'Send either place_id or google_place_id, not both',
        );
      }
    }

    // Resolve google_place_id → places.id (overrides any place_id in input
    // only when the architect-allowed shape is used; mixing was rejected
    // above).
    let resolvedPlaceIdPatch: string | null | undefined = input.place_id;
    if (
      input.google_place_id !== undefined &&
      input.google_place_id !== null
    ) {
      const resolved = await resolveGooglePlaceId(
        supabase,
        input.google_place_id,
      );
      if (!resolved.ok) {
        if (resolved.reason === 'not_cached') {
          return errorResponse(
            'place_not_cached',
            'Place is not cached; fetch place details first',
            400,
          );
        }
        return serverError();
      }
      resolvedPlaceIdPatch = resolved.placeId;
    }

    // Cross-field constraints across PATCH + existing — re-check under merge.
    // `place_id` semantics: explicit `null` in patch → cleared; `undefined` →
    // unchanged (fall back to existing).
    const placeIdMerged: string | null =
      resolvedPlaceIdPatch === undefined
        ? existing.place_id
        : resolvedPlaceIdPatch;
    const hotelNameMerged: string | null =
      input.hotel_name === undefined
        ? existing.hotel_name
        : (input.hotel_name ?? null);
    const merged = {
      place_id: placeIdMerged,
      hotel_name: hotelNameMerged,
      check_in_date: input.check_in_date ?? existing.check_in_date,
      check_out_date: input.check_out_date ?? existing.check_out_date,
      cost_per_night:
        input.cost_per_night ?? existing.cost_per_night ?? null,
      total_cost: input.total_cost ?? existing.total_cost ?? null,
      currency: input.currency ?? existing.currency ?? null,
    };

    if (!merged.place_id && (!merged.hotel_name || merged.hotel_name.trim() === '')) {
      // Server-side guard mirrors the `accommodations_name_or_place` DB CHECK
      // — prevents a PATCH that nulls place_id while hotel_name is also empty.
      return errorResponse(
        'name_or_place_required',
        'Provide a hotel name or link a place',
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

    // Verify a newly-supplied (resolved) place_id exists in `places`.
    if (
      resolvedPlaceIdPatch !== undefined &&
      resolvedPlaceIdPatch !== null
    ) {
      const { data: placeRow, error: placeErr } = await supabase
        .from('places')
        .select('id')
        .eq('id', resolvedPlaceIdPatch)
        .maybeSingle();
      if (placeErr) return serverError();
      if (!placeRow) {
        return errorResponse('place_not_found', 'Place not found', 400);
      }
    }

    // Build sparse update — only include keys actually present in the input.
    const patch: Record<string, unknown> = {};
    if (resolvedPlaceIdPatch !== undefined) {
      // Either explicit-null (clear) or a resolved uuid.
      patch.place_id = resolvedPlaceIdPatch;
    }
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
