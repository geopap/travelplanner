/**
 * B-013 — Member list endpoint.
 *
 * GET /api/trips/[id]/members
 *
 * Returns all accepted members of a trip with joined profile data
 * (full_name, avatar_url, email from public.profiles). Any trip member
 * (owner / editor / viewer) may call this endpoint — AC-1, AC-7.
 *
 * Schema observations:
 * - public.trip_members has a `status` column ('pending'|'accepted'|'revoked').
 *   Only 'accepted' rows are returned; pending invitations live separately in
 *   trip_invitations (B-013 AC-10).
 * - public.profiles exposes: id, email, full_name, avatar_url (no display_name
 *   column — full_name is the display field).
 * - Members are ordered by accepted_at ASC NULLS LAST (chronological join order).
 *
 * Performance: single SELECT with foreign-table join into `profiles`; no N+1.
 * Pagination: ?page (default 1) / ?limit (default 20, max 100) via PageSchema.
 *
 * Responses:
 *   200  { members: MemberWithProfile[], page, limit, total }
 *   400  invalid_query
 *   401  unauthorized
 *   403  not_a_member
 *   404  trip not found (UUID invalid)
 *   500  server_error
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { PageSchema, UuidSchema } from '@/lib/validations/common';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  errorResponse,
  serverError,
  unauthorized,
  notFound,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import type { MemberProfile, MemberWithProfile } from '@/lib/types/members';
import { isMemberRole, isMemberStatus } from '@/lib/types/members';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Narrows a raw Supabase row (unknown) into MemberWithProfile.
 * Returns null if the row is structurally invalid — signals a DB invariant
 * violation and is handled upstream as a server error.
 */
function parseMemberRow(row: unknown): MemberWithProfile | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;

  if (typeof r.trip_id !== 'string') return null;
  if (typeof r.user_id !== 'string') return null;
  if (!isMemberRole(r.role)) return null;
  if (!isMemberStatus(r.status)) return null;
  if (typeof r.invited_at !== 'string') return null;

  const invited_by =
    r.invited_by === null || typeof r.invited_by === 'string'
      ? r.invited_by
      : null;
  const accepted_at =
    r.accepted_at === null || typeof r.accepted_at === 'string'
      ? r.accepted_at
      : null;

  // Supabase may return the joined relation as an array or a single object.
  const rawProfile = Array.isArray(r.profile) ? r.profile[0] : r.profile;
  if (!rawProfile || typeof rawProfile !== 'object') return null;
  const p = rawProfile as Record<string, unknown>;

  if (typeof p.email !== 'string') return null;
  const profile: MemberProfile = {
    email: p.email,
    full_name:
      typeof p.full_name === 'string' ? p.full_name : null,
    avatar_url:
      typeof p.avatar_url === 'string' ? p.avatar_url : null,
  };

  return {
    trip_id: r.trip_id,
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    invited_by,
    invited_at: r.invited_at,
    accepted_at,
    profile,
  };
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

    // Any accepted member (viewer or above) may see the member list.
    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) {
      // Map not_found → 403 not_a_member (consistent with PATCH/DELETE handlers
      // on this trip; avoids leaking trip existence to non-members).
      return errorResponse(
        'not_a_member',
        'You are not a member of this trip',
        403,
      );
    }

    const url = new URL(request.url);
    const pageParsed = PageSchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!pageParsed.success) {
      return errorResponse('invalid_query', 'Invalid query parameters', 400, {
        fieldErrors: pageParsed.error.flatten().fieldErrors,
      });
    }
    const { page, limit } = pageParsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Single query: trip_members joined with profiles (no N+1).
    // Only accepted rows are returned; pending invitations are excluded (AC-10).
    // Ordered by accepted_at ASC NULLS LAST (chronological join order).
    const { data, error, count } = await supabase
      .from('trip_members')
      .select(
        'trip_id, user_id, role, status, invited_by, invited_at, accepted_at, profile:profiles!trip_members_profile_fk(email, full_name, avatar_url)',
        { count: 'exact' },
      )
      .eq('trip_id', id)
      .eq('status', 'accepted')
      .order('accepted_at', { ascending: true, nullsFirst: false })
      .range(from, to);

    if (error) return serverError();

    const members: MemberWithProfile[] = [];
    for (const row of data ?? []) {
      const parsed = parseMemberRow(row);
      if (parsed === null) return serverError();
      members.push(parsed);
    }

    return NextResponse.json({
      members,
      page,
      limit,
      total: count ?? 0,
    });
  } catch {
    return serverError();
  }
}
