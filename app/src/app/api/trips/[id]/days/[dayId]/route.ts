import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import { UpdateTripDayInput } from '@/lib/validations/trip-days';
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
import type { TripDay } from '@/lib/types/domain';

type RouteCtx = { params: Promise<{ id: string; dayId: string }> };

export async function PATCH(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id, dayId } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();
    if (!UuidSchema.safeParse(dayId).success) return notFound();

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
    const parsed = UpdateTripDayInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updatePayload.title = parsed.data.title;
    if (parsed.data.notes !== undefined) updatePayload.notes = parsed.data.notes;

    // Server enforces day belongs to the trip in URL.
    const { data, error } = await supabase
      .from('trip_days')
      .update(updatePayload)
      .eq('id', dayId)
      .eq('trip_id', id)
      .select('*')
      .maybeSingle();

    if (error) return serverError();
    if (!data) return notFound();

    await logAudit({
      actorId: auth.user.id,
      action: 'update',
      entity: 'trip_days',
      entityId: dayId,
      tripId: id,
      metadata: { changed_fields: Object.keys(updatePayload) },
    });

    return NextResponse.json({ day: data as TripDay });
  } catch {
    return serverError();
  }
}
