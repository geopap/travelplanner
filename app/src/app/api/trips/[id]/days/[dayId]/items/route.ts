import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema, PageSchema } from '@/lib/validations/common';
import { CreateItineraryItemInput } from '@/lib/validations/itinerary-items';
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

type RouteCtx = { params: Promise<{ id: string; dayId: string }> };

async function verifyDayBelongsToTrip(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tripId: string,
  dayId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('trip_days')
    .select('id')
    .eq('id', dayId)
    .eq('trip_id', tripId)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function GET(
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

    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) return notFound();

    if (!(await verifyDayBelongsToTrip(supabase, id, dayId))) return notFound();

    const url = new URL(request.url);
    const pageParsed = PageSchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!pageParsed.success) return validationError(pageParsed.error);
    const { page, limit } = pageParsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from('itinerary_items')
      .select('*', { count: 'exact' })
      .eq('trip_id', id)
      .eq('day_id', dayId)
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) return serverError();

    return NextResponse.json({
      items: (data ?? []) as ItineraryItem[],
      page,
      limit,
      total: count ?? 0,
    });
  } catch {
    return serverError();
  }
}

export async function POST(
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

    if (!(await verifyDayBelongsToTrip(supabase, id, dayId))) return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = CreateItineraryItemInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Server sets trip_id + day_id from URL — never from body (B-006 AC 7).
    const { data, error } = await supabase
      .from('itinerary_items')
      .insert({
        trip_id: id,
        day_id: dayId,
        type: input.type,
        start_time: input.start_time ?? null,
        end_time: input.end_time ?? null,
        title: input.title,
        external_url: input.external_url ?? null,
        notes: input.notes ?? null,
        cost: input.cost ?? null,
        currency: input.currency ?? null,
        created_by: auth.user.id,
      })
      .select('*')
      .single();
    if (error || !data) return serverError();

    await logAudit({
      actorId: auth.user.id,
      action: 'create',
      entity: 'itinerary_items',
      entityId: data.id,
      tripId: id,
      metadata: { type: input.type, day_id: dayId },
    });

    return NextResponse.json({ item: data as ItineraryItem }, { status: 201 });
  } catch {
    return serverError();
  }
}
