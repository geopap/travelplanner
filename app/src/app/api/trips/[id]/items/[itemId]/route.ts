import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema } from '@/lib/validations/common';
import {
  ItineraryItemRowSchema,
  UpdateItineraryItemInput,
} from '@/lib/validations/itinerary-items';
import { TransportationRowSchema } from '@/lib/validations/transportation';
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
import type { Transportation } from '@/lib/types/transportation';

type RouteCtx = { params: Promise<{ id: string; itemId: string }> };

/** Shape returned by the update_transport_item RPC. */
const UpdateTransportRpcResultSchema = z.object({
  item_id: z.string().uuid(),
  transportation_id: z.string().uuid().nullable(),
  type: z.enum(['transport', 'lodging', 'activity', 'meal', 'note']),
});

export async function GET(
  _req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id, itemId } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();
    if (!UuidSchema.safeParse(itemId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) return notFound();

    const { data, error } = await supabase
      .from('itinerary_items')
      .select('*')
      .eq('id', itemId)
      .eq('trip_id', id)
      .maybeSingle();
    if (error) return serverError();
    if (!data) return notFound();

    const itemParsed = ItineraryItemRowSchema.safeParse(data);
    if (!itemParsed.success) return serverError();
    const item = itemParsed.data;

    // For transport-type items, fetch the linked transportation row.
    if (item.type === 'transport') {
      const { data: trans, error: tErr } = await supabase
        .from('transportation')
        .select('*')
        .eq('itinerary_item_id', itemId)
        .eq('trip_id', id)
        .maybeSingle();
      if (tErr) return serverError();
      let transportation: Transportation | null = null;
      if (trans) {
        const transParsed = TransportationRowSchema.safeParse(trans);
        if (!transParsed.success) return serverError();
        transportation = transParsed.data;
      }
      return NextResponse.json({ item, transportation });
    }

    return NextResponse.json({ item });
  } catch {
    return serverError();
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id, itemId } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();
    if (!UuidSchema.safeParse(itemId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = UpdateItineraryItemInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Look up current type + trip-membership of the item (defense-in-depth).
    const ExistingItemSchema = z.object({
      id: z.string().uuid(),
      type: z.enum(['transport', 'lodging', 'activity', 'meal', 'note']),
      trip_id: z.string().uuid(),
    });
    const { data: existing, error: existErr } = await supabase
      .from('itinerary_items')
      .select('id, type, trip_id')
      .eq('id', itemId)
      .eq('trip_id', id)
      .maybeSingle();
    if (existErr) return serverError();
    if (!existing) return notFound();
    const existingParsed = ExistingItemSchema.safeParse(existing);
    if (!existingParsed.success) return serverError();
    const currentType = existingParsed.data.type;
    const targetType = input.type ?? currentType;
    const wasTransport = currentType === 'transport';
    const willBeTransport = targetType === 'transport';

    // Verify day_id move (if requested).
    if (input.day_id) {
      const { data: dayRow, error: dayErr } = await supabase
        .from('trip_days')
        .select('id')
        .eq('id', input.day_id)
        .eq('trip_id', id)
        .maybeSingle();
      if (dayErr) return serverError();
      if (!dayRow) return badRequest('Target day does not belong to this trip');
    }

    // AC-10 enforcement at the route layer (the schema can't fully express it
    // for the union of patch shapes). When the resulting type is transport,
    // cost/currency MUST NOT be present on the parent payload.
    if (
      willBeTransport &&
      (input.cost !== undefined || input.currency !== undefined)
    ) {
      return errorResponse(
        'transport_cost_on_item_forbidden',
        'cost and currency live on the transportation row when type=transport',
        400,
      );
    }

    // Case c (becoming transport from another type): payload MUST include the
    // transportation sub-object.
    if (
      willBeTransport &&
      !wasTransport &&
      input.transportation === undefined
    ) {
      return errorResponse(
        'transport_payload_required',
        'transportation payload is required when changing type to transport',
        400,
      );
    }

    // ----- Dispatch path: any case where transport is touched goes through
    // the atomic RPC. Otherwise, fall back to the simple in-place update.
    if (wasTransport || willBeTransport) {
      // Build the item-patch as a plain object (drop `transportation` sub-key
      // and `type` — those are handled separately by the RPC contract).
      const itemPatch: Record<string, unknown> = {};
      for (const key of [
        'day_id',
        'title',
        'start_time',
        'end_time',
        'external_url',
        'notes',
        'cost',
        'currency',
      ] as const) {
        if (input[key] !== undefined) itemPatch[key] = input[key];
      }

      const transportationPayload =
        input.transportation === undefined ? null : input.transportation;

      const { data: rpcRaw, error: rpcErr } = await supabase.rpc(
        'update_transport_item',
        {
          p_trip_id: id,
          p_item_id: itemId,
          p_item_patch: itemPatch,
          p_transportation: transportationPayload,
          p_new_type: input.type ?? null,
        },
      );
      if (rpcErr) {
        const msg = rpcErr.message ?? '';
        if (msg.includes('forbidden')) return forbidden();
        if (msg.includes('item_not_found')) return notFound();
        if (msg.includes('item_not_in_trip')) return notFound();
        if (msg.includes('day_not_in_trip')) {
          return badRequest('Target day does not belong to this trip');
        }
        if (msg.includes('transport_cost_on_item_forbidden')) {
          return errorResponse(
            'transport_cost_on_item_forbidden',
            'cost and currency live on the transportation row when type=transport',
            400,
          );
        }
        if (msg.includes('transport_payload_required')) {
          return errorResponse(
            'transport_payload_required',
            'transportation payload is required when changing type to transport',
            400,
          );
        }
        return serverError();
      }
      const rpcParsed = UpdateTransportRpcResultSchema.safeParse(rpcRaw);
      if (!rpcParsed.success) return serverError();

      // Re-fetch the item + (optional) transportation row for the response.
      const { data: itemRow, error: itemErr } = await supabase
        .from('itinerary_items')
        .select('*')
        .eq('id', itemId)
        .eq('trip_id', id)
        .maybeSingle();
      if (itemErr) return serverError();
      if (!itemRow) return notFound();

      let transportation: Transportation | null = null;
      if (rpcParsed.data.transportation_id) {
        const { data: t, error: tErr } = await supabase
          .from('transportation')
          .select('*')
          .eq('id', rpcParsed.data.transportation_id)
          .eq('trip_id', id)
          .maybeSingle();
        if (tErr) return serverError();
        if (t) {
          const tParsed = TransportationRowSchema.safeParse(t);
          if (!tParsed.success) return serverError();
          transportation = tParsed.data;
        }
      }

      const itemRowParsed = ItineraryItemRowSchema.safeParse(itemRow);
      if (!itemRowParsed.success) return serverError();

      await logAudit({
        actorId: auth.user.id,
        action: willBeTransport
          ? 'transport_item_updated'
          : 'transport_item_deleted',
        entity: 'itinerary_items',
        entityId: itemId,
        tripId: id,
        metadata: {
          mode: transportation?.mode ?? null,
          has_confirmation: Boolean(transportation?.confirmation),
        },
      });

      return NextResponse.json({
        item: itemRowParsed.data,
        transportation,
      });
    }

    // ----- Non-transport-related patch: original simple update path. -----
    const updatePayload: Record<string, unknown> = {};
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
      if (key === 'transportation') continue;
      if (input[key] !== undefined) updatePayload[key] = input[key];
    }

    const { data, error } = await supabase
      .from('itinerary_items')
      .update(updatePayload)
      .eq('id', itemId)
      .eq('trip_id', id)
      .select('*')
      .maybeSingle();
    if (error) return serverError();
    if (!data) return notFound();

    const dataParsed = ItineraryItemRowSchema.safeParse(data);
    if (!dataParsed.success) return serverError();

    await logAudit({
      actorId: auth.user.id,
      action: 'update',
      entity: 'itinerary_items',
      entityId: itemId,
      tripId: id,
      metadata: { changed_fields: Object.keys(updatePayload) },
    });

    return NextResponse.json({ item: dataParsed.data });
  } catch {
    return serverError();
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id, itemId } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();
    if (!UuidSchema.safeParse(itemId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // Read type before delete so we can choose the audit action; the
    // transportation row (if any) is removed via ON DELETE CASCADE.
    const { data: prior } = await supabase
      .from('itinerary_items')
      .select('type')
      .eq('id', itemId)
      .eq('trip_id', id)
      .maybeSingle();
    const PriorTypeSchema = z.object({
      type: z.enum(['transport', 'lodging', 'activity', 'meal', 'note']),
    });
    const priorParsed = prior ? PriorTypeSchema.safeParse(prior) : null;
    const wasTransport =
      priorParsed !== null && priorParsed.success && priorParsed.data.type === 'transport';

    const { data, error } = await supabase
      .from('itinerary_items')
      .delete()
      .eq('id', itemId)
      .eq('trip_id', id)
      .select('id')
      .maybeSingle();
    if (error) return serverError();
    if (!data) return notFound();

    await logAudit({
      actorId: auth.user.id,
      action: wasTransport ? 'transport_item_deleted' : 'delete',
      entity: 'itinerary_items',
      entityId: itemId,
      tripId: id,
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
