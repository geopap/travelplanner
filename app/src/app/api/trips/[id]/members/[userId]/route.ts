/**
 * B-013 — Member role management.
 *
 * PATCH /api/trips/[id]/members/[userId]   — owner-only role change.
 * DELETE /api/trips/[id]/members/[userId]  — owner removes other / non-owner self-leave.
 *
 * Defense-in-depth (3 layers):
 *   1. App-layer auth check (this file).
 *   2. RLS policies on public.trip_members (migration 0010).
 *   3. Triggers + SECURITY DEFINER RPC change_member_role() (migration 0010).
 *
 * Auth: requires Supabase session. Caller's role is verified server-side via
 * `checkTripAccess` — client-supplied role is not trusted.
 *
 * Audit: never logs email or display name; only target_user_id, from_role,
 * to_role / target_role.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import { MemberRoleUpdateSchema } from '@/lib/validations/members';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { logAudit } from '@/lib/audit';
import type { MemberRole } from '@/lib/types/domain';
import type { TripMember } from '@/lib/types/members';
import { isMemberRole, isMemberStatus } from '@/lib/types/members';

type RouteCtx = {
  params: Promise<{ id: string; userId: string }>;
};

/** Narrow an unknown row from supabase into the `TripMember` shape. */
function parseMemberRow(row: unknown): TripMember | null {
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

  return {
    trip_id: r.trip_id,
    user_id: r.user_id,
    role: r.role,
    status: r.status,
    invited_by,
    invited_at: r.invited_at,
    accepted_at,
  };
}

/* =========================================================================
 * PATCH — change a member's role (owner-only).
 * ========================================================================= */
export async function PATCH(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, userId: targetUserId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(targetUserId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const callerId = auth.user.id;

    // App-layer guard: caller must be an accepted member with role 'owner'.
    const access = await checkTripAccess(supabase, tripId, callerId, 'owner');
    if (!access.ok) {
      // not_found → 404; forbidden → 403 ('not_a_member' surfaced separately
      // for evicted-session detection on trip-scoped paths).
      if (access.reason === 'not_found') {
        return errorResponse(
          'not_a_member',
          'You are not a member of this trip',
          403,
        );
      }
      return forbidden();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = MemberRoleUpdateSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const newRole: MemberRole = parsed.data.role;

    // Look up current target row for audit + 404 detection.
    const { data: targetExisting, error: targetErr } = await supabase
      .from('trip_members')
      .select('trip_id, user_id, role, status')
      .eq('trip_id', tripId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (targetErr) return serverError();
    if (
      !targetExisting ||
      targetExisting.status !== 'accepted' ||
      !isMemberRole(targetExisting.role)
    ) {
      return errorResponse('member_not_found', 'Member not found', 404);
    }
    const oldRole: MemberRole = targetExisting.role;

    // Atomic role change via SECURITY DEFINER RPC.
    // The RPC re-checks owner status, looks up sole-owner count, and applies
    // the update in a single transaction.
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      'change_member_role',
      {
        p_trip_id: tripId,
        p_target_user_id: targetUserId,
        p_new_role: newRole,
      },
    );

    if (rpcErr) {
      const msg = rpcErr.message ?? '';
      if (msg.includes('cannot_demote_sole_owner')) {
        return errorResponse(
          'cannot_demote_sole_owner',
          'You are the sole owner of this trip. Promote another owner before demoting yourself.',
          409,
        );
      }
      if (msg.includes('member_not_found')) {
        return errorResponse('member_not_found', 'Member not found', 404);
      }
      if (msg.includes('forbidden')) {
        return forbidden();
      }
      if (msg.includes('unauthorized')) {
        return unauthorized();
      }
      if (msg.includes('invalid_role')) {
        return badRequest('Invalid role');
      }
      return serverError();
    }

    const updatedMember = parseMemberRow(rpcData);
    if (!updatedMember) return serverError();

    await logAudit({
      actorId: callerId,
      action: 'member_role_updated',
      entity: 'trip_members',
      entityId: targetUserId,
      tripId,
      metadata: {
        target_user_id: targetUserId,
        from_role: oldRole,
        to_role: newRole,
      },
    });

    return NextResponse.json({ member: updatedMember });
  } catch {
    return serverError();
  }
}

/* =========================================================================
 * DELETE — remove a member.
 *   - Owner removing OTHER member: allowed (multi-owner allowed).
 *   - Non-owner self-leave: allowed.
 *   - Owner self-delete: 403 owner_self_delete_forbidden.
 * ========================================================================= */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, userId: targetUserId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(targetUserId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const callerId = auth.user.id;

    // Caller must at least be a viewer to interact with this trip's members.
    const access = await checkTripAccess(supabase, tripId, callerId, 'viewer');
    if (!access.ok) {
      if (access.reason === 'not_found') {
        return errorResponse(
          'not_a_member',
          'You are not a member of this trip',
          403,
        );
      }
      return forbidden();
    }
    const callerRole: MemberRole = access.role;
    const isSelf = targetUserId === callerId;

    // Authorization matrix
    if (isSelf) {
      // Owners cannot self-remove regardless of count (AC-3).
      if (callerRole === 'owner') {
        return errorResponse(
          'owner_self_delete_forbidden',
          'Owners cannot remove themselves; delete the trip instead.',
          403,
        );
      }
      // Editor / viewer self-leave is allowed.
    } else {
      // Removing someone else requires owner role.
      if (callerRole !== 'owner') {
        return forbidden();
      }
    }

    // Look up target for 404 + audit metadata (no PII).
    const { data: targetExisting, error: targetErr } = await supabase
      .from('trip_members')
      .select('trip_id, user_id, role, status')
      .eq('trip_id', tripId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (targetErr) return serverError();
    if (
      !targetExisting ||
      targetExisting.status !== 'accepted' ||
      !isMemberRole(targetExisting.role)
    ) {
      return errorResponse('member_not_found', 'Member not found', 404);
    }
    const targetRole: MemberRole = targetExisting.role;

    const { error: deleteErr } = await supabase
      .from('trip_members')
      .delete()
      .eq('trip_id', tripId)
      .eq('user_id', targetUserId);

    if (deleteErr) {
      const msg = deleteErr.message ?? '';
      if (msg.includes('owner_self_delete_forbidden')) {
        return errorResponse(
          'owner_self_delete_forbidden',
          'Owners cannot remove themselves; delete the trip instead.',
          403,
        );
      }
      return serverError();
    }

    await logAudit({
      actorId: callerId,
      action: isSelf ? 'member_left' : 'member_removed',
      entity: 'trip_members',
      entityId: targetUserId,
      tripId,
      metadata: {
        target_user_id: targetUserId,
        target_role: targetRole,
        self_leave: isSelf,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
