/**
 * B-013 — Shared types for member-management API.
 *
 * Mirrors the `trip_members` row shape and the API DTO. Re-uses the
 * canonical `MemberRole` from `domain.ts`.
 */

import type { MemberRole } from './domain';

export type MemberStatus = 'pending' | 'accepted' | 'revoked';

/** Row from public.trip_members (canonical). */
export interface TripMember {
  trip_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
}

/** API response DTO for PATCH /api/trips/[id]/members/[userId]. */
export interface MemberUpdateResponse {
  member: TripMember;
}

/** Profile fields available from the joined `profiles` table. */
export interface MemberProfile {
  full_name: string | null;
  avatar_url: string | null;
  email: string;
}

/**
 * API response DTO for GET /api/trips/[id]/members.
 * Includes joined profile data from public.profiles.
 */
export interface MemberWithProfile {
  trip_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  profile: MemberProfile;
}

/** Paginated response for GET /api/trips/[id]/members. */
export interface MembersListResponse {
  members: MemberWithProfile[];
  page: number;
  limit: number;
  total: number;
}

/* ---------------------------------------------------------------------------
 * Runtime narrowing helpers — used by routes that read `trip_members` rows
 * back from Supabase as `unknown`. Centralized here so the role/status
 * tuples stay in lockstep with the type definitions above.
 * ------------------------------------------------------------------------- */

const MEMBER_ROLES = ['owner', 'editor', 'viewer'] as const;
const MEMBER_STATUSES = ['pending', 'accepted', 'revoked'] as const;

export function isMemberRole(v: unknown): v is MemberRole {
  return typeof v === 'string' && (MEMBER_ROLES as readonly string[]).includes(v);
}

export function isMemberStatus(v: unknown): v is MemberStatus {
  return (
    typeof v === 'string' && (MEMBER_STATUSES as readonly string[]).includes(v)
  );
}
