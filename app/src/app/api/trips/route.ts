import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { CreateTripInput } from '@/lib/validations/trips';
import { PageSchema, daysBetween } from '@/lib/validations/common';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { logAudit } from '@/lib/audit';
import type { Trip, TripDay } from '@/lib/types/domain';

/** GET /api/trips — list trips the current user is an accepted member of. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return unauthorized();

    const url = new URL(request.url);
    const pageParsed = PageSchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!pageParsed.success) return validationError(pageParsed.error);
    const { page, limit } = pageParsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // RLS already restricts to accepted members via is_trip_member().
    const { data, error, count } = await supabase
      .from('trips')
      .select('*', { count: 'exact' })
      .order('start_date', { ascending: false })
      .range(from, to);

    if (error) return serverError();

    return NextResponse.json({
      items: (data ?? []) as Trip[],
      page,
      limit,
      total: count ?? 0,
    });
  } catch {
    return serverError();
  }
}

/** POST /api/trips — create trip + seed trip_days. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return unauthorized();
    const userId = authData.user.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = CreateTripInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    const { data: trip, error } = await supabase
      .from('trips')
      .insert({
        owner_id: userId,
        name: input.name,
        start_date: input.start_date,
        end_date: input.end_date,
        destination: input.destination ?? null,
        base_currency: input.base_currency,
        total_budget: input.total_budget ?? null,
        cover_image_url: input.cover_image_url ?? null,
      })
      .select('*')
      .single();

    if (error || !trip) return serverError();

    // Seed trip_days — one row per calendar day inclusive.
    const dayCount = daysBetween(input.start_date, input.end_date) + 1;
    const dayRows = Array.from({ length: dayCount }, (_, i) => {
      const d = new Date(`${input.start_date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return {
        trip_id: trip.id,
        day_number: i + 1,
        date: iso,
      };
    });

    const { data: days, error: daysErr } = await supabase
      .from('trip_days')
      .insert(dayRows)
      .select('*');

    if (daysErr) {
      // Roll back the trip — editor RLS on trip_members seed should make this
      // rare, but handle defensively.
      await supabase.from('trips').delete().eq('id', trip.id);
      return serverError();
    }

    await logAudit({
      actorId: userId,
      action: 'create',
      entity: 'trips',
      entityId: trip.id,
      tripId: trip.id,
      metadata: {
        start_date: input.start_date,
        end_date: input.end_date,
        day_count: dayCount,
      },
    });

    return NextResponse.json(
      { trip: trip as Trip, days: (days ?? []) as TripDay[] },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}
