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
import type { MemberRole, Trip, TripDay } from '@/lib/types/domain';

interface TripWithRoleRow extends Trip {
  role: MemberRole;
}

interface TripJoinRow extends Trip {
  trip_members: { role: MemberRole }[] | { role: MemberRole } | null;
}

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
    // Join trip_members for the current user to expose the caller's role
    // per trip — used by clients (e.g. TripPickerDialog) to gate writes.
    const { data, error, count } = await supabase
      .from('trips')
      .select('*, trip_members!inner(role)', { count: 'exact' })
      .eq('trip_members.user_id', authData.user.id)
      .order('start_date', { ascending: false })
      .range(from, to);

    if (error) return serverError();

    const rows = (data ?? []) as TripJoinRow[];
    const items: TripWithRoleRow[] = rows.map((row) => {
      const { trip_members, ...trip } = row;
      const member = Array.isArray(trip_members)
        ? trip_members[0]
        : trip_members;
      const role: MemberRole = member?.role ?? 'viewer';
      return { ...(trip as Trip), role };
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
