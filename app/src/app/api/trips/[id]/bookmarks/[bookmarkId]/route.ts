import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import {
  BookmarkRowSchema,
  UpdateBookmarkInput,
  mapBookmarkRow,
} from '@/lib/validations/bookmarks';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  serverError,
  sessionExpired,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { POSTGRES_RLS_VIOLATION_CODE, requireFreshSession } from '@/lib/api/auth-guard';
import { checkTripAccess } from '@/lib/trip-access';
import { logAudit } from '@/lib/audit';

type RouteCtx = { params: Promise<{ id: string; bookmarkId: string }> };

const BOOKMARK_SELECT =
  'id, trip_id, place_id, category, notes, added_by, created_at, updated_at, place:places(name, formatted_address, category, lat, lng)';

export async function PATCH(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, bookmarkId: id } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const fresh = await requireFreshSession(supabase, auth.user);
    if (!fresh.ok) return sessionExpired();

    // Verify the bookmark belongs to the URL's trip (defense-in-depth vs RLS).
    const { data: existing, error: existingErr } = await supabase
      .from('bookmarks')
      .select('id, trip_id')
      .eq('id', id)
      .maybeSingle();
    if (existingErr) return serverError();
    if (!existing || existing.trip_id !== tripId) return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = UpdateBookmarkInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    const patch: { category?: string; notes?: string | null } = {};
    if (input.category !== undefined) patch.category = input.category;
    if (input.notes !== undefined) patch.notes = input.notes;

    const { data: updated, error: updateErr } = await supabase
      .from('bookmarks')
      .update(patch)
      .eq('id', id)
      .eq('trip_id', tripId)
      .select(BOOKMARK_SELECT)
      .single();

    if (updateErr) {
      if (updateErr.code === '23505') {
        return errorResponse(
          'bookmark_exists',
          'A bookmark for this place and category already exists',
          409,
        );
      }
      if (updateErr.code === POSTGRES_RLS_VIOLATION_CODE) return sessionExpired();
      return serverError();
    }
    if (!updated) return serverError();

    const updatedParsed = BookmarkRowSchema.safeParse(updated);
    if (!updatedParsed.success) return serverError();

    await logAudit({
      actorId: userId,
      action: 'bookmark_updated',
      entity: 'bookmarks',
      entityId: id,
      tripId,
      metadata: {
        fields: Object.keys(patch),
      },
    });

    return NextResponse.json({ bookmark: mapBookmarkRow(updatedParsed.data) });
  } catch {
    return serverError();
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, bookmarkId: id } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const fresh = await requireFreshSession(supabase, auth.user);
    if (!fresh.ok) return sessionExpired();

    const { data: existing, error: existingErr } = await supabase
      .from('bookmarks')
      .select('id, trip_id')
      .eq('id', id)
      .maybeSingle();
    if (existingErr) return serverError();
    if (!existing || existing.trip_id !== tripId) return notFound();

    const { error: deleteErr } = await supabase
      .from('bookmarks')
      .delete()
      .eq('id', id)
      .eq('trip_id', tripId);
    if (deleteErr) {
      if (deleteErr.code === POSTGRES_RLS_VIOLATION_CODE) return sessionExpired();
      return serverError();
    }

    await logAudit({
      actorId: userId,
      action: 'bookmark_deleted',
      entity: 'bookmarks',
      entityId: id,
      tripId,
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
