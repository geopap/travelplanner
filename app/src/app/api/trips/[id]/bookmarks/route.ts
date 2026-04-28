import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema } from '@/lib/validations/common';
import {
  BookmarkRowSchema,
  CreateBookmarkInput,
  ListBookmarksQuery,
  mapBookmarkRow,
} from '@/lib/validations/bookmarks';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  rateLimited,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { narrowCategoryForBookmark } from '@/lib/bookmarks/categories';
import type { PlaceCategory } from '@/lib/types/domain';

type RouteCtx = { params: Promise<{ id: string }> };

const BOOKMARK_CREATE_WINDOW_MS = 60 * 1000; // 60s
const BOOKMARK_CREATE_MAX = 10;

const PlaceLookupSchema = z.object({
  id: z.string().uuid(),
  category: z.enum([
    'restaurant',
    'cafe',
    'bar',
    'sight',
    'museum',
    'shopping',
    'hotel',
    'transport_hub',
    'park',
    'other',
  ]),
});

export async function POST(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const rl = checkRateLimit(
      `bookmarks:create:user:${userId}:trip:${tripId}`,
      BOOKMARK_CREATE_WINDOW_MS,
      BOOKMARK_CREATE_MAX,
    );
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = CreateBookmarkInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Resolve the place row from google_place_id. Must already be cached.
    const { data: placeRaw, error: placeErr } = await supabase
      .from('places')
      .select('id, category')
      .eq('google_place_id', input.google_place_id)
      .maybeSingle();
    if (placeErr) return serverError();
    if (!placeRaw) {
      return errorResponse(
        'place_not_cached',
        'Place is not cached; fetch place details first',
        404,
      );
    }
    const placeParsed = PlaceLookupSchema.safeParse(placeRaw);
    if (!placeParsed.success) return serverError();
    const place = placeParsed.data;

    const category =
      input.category ??
      narrowCategoryForBookmark(place.category as PlaceCategory);

    const { data: inserted, error: insertErr } = await supabase
      .from('bookmarks')
      .insert({
        trip_id: tripId,
        place_id: place.id,
        category,
        notes: input.notes ?? null,
        added_by: userId,
      })
      .select(
        'id, trip_id, place_id, category, notes, added_by, created_at, updated_at, place:places(name, formatted_address, category, lat, lng)',
      )
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return errorResponse(
          'bookmark_exists',
          'A bookmark for this place and category already exists',
          409,
        );
      }
      return serverError();
    }
    if (!inserted) return serverError();

    const insertedParsed = BookmarkRowSchema.safeParse(inserted);
    if (!insertedParsed.success) return serverError();

    await logAudit({
      actorId: userId,
      action: 'bookmark_created',
      entity: 'bookmarks',
      entityId: insertedParsed.data.id,
      tripId,
      metadata: { category, place_id: place.id },
    });

    return NextResponse.json(
      { bookmark: mapBookmarkRow(insertedParsed.data) },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}

export async function GET(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, tripId, auth.user.id, 'viewer');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const url = new URL(request.url);
    const parsed = ListBookmarksQuery.safeParse({
      category: url.searchParams.get('category') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!parsed.success) {
      return errorResponse('invalid_query', 'Invalid query', 400, {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const { category, page, limit } = parsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('bookmarks')
      .select(
        'id, trip_id, place_id, category, notes, added_by, created_at, updated_at, place:places(name, formatted_address, category, lat, lng)',
        { count: 'exact' },
      )
      .eq('trip_id', tripId);
    if (category) query = query.eq('category', category);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) return serverError();

    const parsedRows = BookmarkRowSchema.array().safeParse(data ?? []);
    if (!parsedRows.success) return serverError();

    return NextResponse.json({
      bookmarks: parsedRows.data.map(mapBookmarkRow),
      page,
      limit,
      total: count ?? 0,
    });
  } catch {
    return serverError();
  }
}
