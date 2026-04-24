import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UpdateTripInput, MAX_TRIP_DURATION_DAYS } from '@/lib/validations/trips';
import { UuidSchema, daysBetween } from '@/lib/validations/common';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  conflict,
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { logAudit } from '@/lib/audit';
import type { Trip } from '@/lib/types/domain';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(
  _req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) return notFound();

    const { data: trip, error } = await supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) return serverError();
    if (!trip) return notFound();

    return NextResponse.json({ trip: trip as Trip, member: { role: access.role } });
  } catch {
    return serverError();
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'owner');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = UpdateTripInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Load current trip for date-shrink computation / duration cap.
    const { data: existing, error: readErr } = await supabase
      .from('trips')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (readErr) return serverError();
    if (!existing) return notFound();

    const nextStart = input.start_date ?? existing.start_date;
    const nextEnd = input.end_date ?? existing.end_date;
    if (nextEnd < nextStart) {
      return badRequest('end_date must be on or after start_date', {
        fieldErrors: { end_date: ['end_date must be on or after start_date'] },
      });
    }
    if (daysBetween(nextStart, nextEnd) > MAX_TRIP_DURATION_DAYS) {
      return badRequest(
        `Trip duration must be at most ${MAX_TRIP_DURATION_DAYS} days`,
        { fieldErrors: { end_date: ['duration exceeds cap'] } },
      );
    }

    // Date-shrink conflict — blocks shrinks that would remove days with items.
    if (
      (input.start_date && input.start_date > existing.start_date) ||
      (input.end_date && input.end_date < existing.end_date)
    ) {
      const { data: doomedDays, error: daysErr } = await supabase
        .from('trip_days')
        .select('id, date')
        .eq('trip_id', id)
        .or(`date.lt.${nextStart},date.gt.${nextEnd}`);
      if (daysErr) return serverError();

      const doomedIds = (doomedDays ?? []).map((d) => d.id);
      if (doomedIds.length > 0) {
        const { data: items, error: itemsErr } = await supabase
          .from('itinerary_items')
          .select('day_id')
          .eq('trip_id', id)
          .in('day_id', doomedIds);
        if (itemsErr) return serverError();

        if ((items ?? []).length > 0) {
          const countByDay = new Map<string, number>();
          for (const it of items ?? []) {
            if (it.day_id) {
              countByDay.set(it.day_id, (countByDay.get(it.day_id) ?? 0) + 1);
            }
          }
          const blocking = (doomedDays ?? [])
            .filter((d) => countByDay.has(d.id))
            .map((d) => ({
              day_id: d.id,
              date: d.date,
              item_count: countByDay.get(d.id) ?? 0,
            }));
          return errorResponse(
            'date_shrink_blocked',
            'Cannot shrink trip: some removed days contain items',
            409,
            { blocking_days: blocking },
          );
        }
      }
    }

    // Apply update.
    const updatePayload: Record<string, unknown> = {};
    for (const key of Object.keys(input) as (keyof typeof input)[]) {
      if (input[key] !== undefined) updatePayload[key] = input[key];
    }

    const { data: updated, error: updErr } = await supabase
      .from('trips')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();
    if (updErr || !updated) return serverError();

    // Extend days if dates expanded.
    const oldStart = existing.start_date as string;
    const oldEnd = existing.end_date as string;
    const toAdd: Array<{ trip_id: string; day_number: number; date: string }> = [];
    if (nextStart < oldStart || nextEnd > oldEnd) {
      // Gather existing day_numbers to continue numbering contiguously.
      const { data: existingDays, error: edErr } = await supabase
        .from('trip_days')
        .select('day_number, date')
        .eq('trip_id', id);
      if (edErr) return serverError();
      const existingDates = new Set((existingDays ?? []).map((d) => d.date as string));
      let maxNumber = 0;
      for (const d of existingDays ?? []) {
        if ((d.day_number as number) > maxNumber) maxNumber = d.day_number as number;
      }
      const span = daysBetween(nextStart, nextEnd) + 1;
      for (let i = 0; i < span; i += 1) {
        const d = new Date(`${nextStart}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const iso = d.toISOString().slice(0, 10);
        if (!existingDates.has(iso)) {
          maxNumber += 1;
          toAdd.push({ trip_id: id, day_number: maxNumber, date: iso });
        }
      }
      if (toAdd.length > 0) {
        const { error: insErr } = await supabase.from('trip_days').insert(toAdd);
        if (insErr) return serverError();
      }
    }

    await logAudit({
      actorId: auth.user.id,
      action: 'update',
      entity: 'trips',
      entityId: id,
      tripId: id,
      metadata: { changed_fields: Object.keys(updatePayload) },
    });

    return NextResponse.json({ trip: updated as Trip });
  } catch {
    return serverError();
  }
}

export async function DELETE(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'owner');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const confirmHeader = request.headers.get('x-confirm-name');
    if (!confirmHeader) {
      return badRequest('Missing X-Confirm-Name header');
    }

    const { data: trip, error: readErr } = await supabase
      .from('trips')
      .select('id, name')
      .eq('id', id)
      .maybeSingle();
    if (readErr) return serverError();
    if (!trip) return notFound();

    if (confirmHeader !== trip.name) {
      return errorResponse('name_mismatch', 'Trip name confirmation does not match', 400);
    }

    const { error: delErr } = await supabase.from('trips').delete().eq('id', id);
    if (delErr) return serverError();

    await logAudit({
      actorId: auth.user.id,
      action: 'delete',
      entity: 'trips',
      entityId: id,
      tripId: id,
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
