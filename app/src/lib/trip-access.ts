import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemberRole } from './types/domain';

export type RequiredRole = 'viewer' | 'editor' | 'owner';

function roleSatisfies(actual: MemberRole, required: RequiredRole): boolean {
  if (required === 'viewer') return true;
  if (required === 'editor') return actual === 'editor' || actual === 'owner';
  return actual === 'owner';
}

export type AccessCheck =
  | { ok: true; role: MemberRole }
  | { ok: false; reason: 'not_found' | 'forbidden' };

/**
 * Defense-in-depth: app-level check that the current user is an accepted
 * member of the trip with at least the required role. RLS still applies
 * and remains the primary isolation boundary.
 *
 * Returns 'not_found' when no accepted membership exists (intentionally
 * mapped to 404 by callers so existence is not leaked).
 */
export async function checkTripAccess(
  supabase: SupabaseClient,
  tripId: string,
  userId: string,
  required: RequiredRole,
): Promise<AccessCheck> {
  const { data, error } = await supabase
    .from('trip_members')
    .select('role, status')
    .eq('trip_id', tripId)
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .maybeSingle();

  if (error) {
    // Unexpected — treat as not found to avoid leaking detail.
    return { ok: false, reason: 'not_found' };
  }
  if (!data) return { ok: false, reason: 'not_found' };

  const role = data.role as MemberRole;
  if (!roleSatisfies(role, required)) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: true, role };
}
