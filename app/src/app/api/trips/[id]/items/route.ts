import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema } from '@/lib/validations/common';
import {
  CreateItineraryItemInput,
  ItineraryItemType,
} from '@/lib/validations/itinerary-items';
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

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Items list/create pagination — cap at 200 (per spec §3.2). This is wider
 * than the default PageSchema (100) because a single trip-day can legitimately
 * contain many items; callers still paginate.
 */
const ItemsPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

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
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) return notFound();

    const url = new URL(request.url);

    // Optional day_id filter.
    const dayIdParam = url.searchParams.get('day_id');
    let dayIdFilter: string | null = null;
    if (dayIdParam !== null && dayIdParam !== '') {
      const dayParsed = UuidSchema.safeParse(dayIdParam);
      if (!dayParsed.success) return badRequest('Invalid day_id');
      if (!(await verifyDayBelongsToTrip(supabase, id, dayParsed.data))) {
        return notFound();
      }
      dayIdFilter = dayParsed.data;
    }

    // Optional type filter.
    const typeParam = url.searchParams.get('type');
    let typeFilter: string | null = null;
    if (typeParam !== null && typeParam !== '') {
      const typeParsed = ItineraryItemType.safeParse(typeParam);
      if (!typeParsed.success) return badRequest('Invalid type');
      typeFilter = typeParsed.data;
    }

    const pageParsed = ItemsPageSchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!pageParsed.success) return validationError(pageParsed.error);
    const { page, limit } = pageParsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('itinerary_items')
      .select('*', { count: 'exact' })
      .eq('trip_id', id);
    if (dayIdFilter !== null) query = query.eq('day_id', dayIdFilter);
    if (typeFilter !== null) query = query.eq('type', typeFilter);

    const { data, error, count } = await query
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
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

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
    const parsed = CreateItineraryItemInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // day_id is required in the flat contract — the URL no longer carries it.
    if (!input.day_id) {
      return badRequest('day_id is required');
    }
    if (!(await verifyDayBelongsToTrip(supabase, id, input.day_id))) {
      return badRequest('Target day does not belong to this trip');
    }

    // Server sets trip_id from URL — never from body.
    const { data, error } = await supabase
      .from('itinerary_items')
      .insert({
        trip_id: id,
        day_id: input.day_id,
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
      metadata: { type: input.type, day_id: input.day_id },
    });

    return NextResponse.json({ item: data as ItineraryItem }, { status: 201 });
  } catch {
    return serverError();
  }
}
