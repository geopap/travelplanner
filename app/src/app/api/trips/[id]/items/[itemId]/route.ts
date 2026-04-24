import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import { UpdateItineraryItemInput } from '@/lib/validations/itinerary-items';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  forbidden,
  notFound,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { logAudit } from '@/lib/audit';
import type { ItineraryItem } from '@/lib/types/domain';

type RouteCtx = { params: Promise<{ id: string; itemId: string }> };

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

    return NextResponse.json({ item: data as ItineraryItem });
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

    // If caller moves item to a different day_id, verify that day belongs to
    // the same trip. trip_id is never accepted from the body — it's fixed by URL.
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

    const updatePayload: Record<string, unknown> = {};
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
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

    await logAudit({
      actorId: auth.user.id,
      action: 'update',
      entity: 'itinerary_items',
      entityId: itemId,
      tripId: id,
      metadata: { changed_fields: Object.keys(updatePayload) },
    });

    return NextResponse.json({ item: data as ItineraryItem });
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
      action: 'delete',
      entity: 'itinerary_items',
      entityId: itemId,
      tripId: id,
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
