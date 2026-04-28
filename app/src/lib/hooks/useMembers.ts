"use client";

// B-013 — Client-side wrappers around the member-management API.
// All calls go through apiFetch so error envelopes are normalized and the
// active-session-eviction handler fires for 403 `not_a_member`.

import { apiFetch } from "@/lib/utils/api-client";
import type { MemberRole } from "@/lib/types/domain";
import type {
  MemberUpdateResponse,
  MembersListResponse,
} from "@/lib/types/members";

export function listMembers(
  tripId: string,
  page = 1,
  limit = 20,
): Promise<MembersListResponse> {
  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  return apiFetch<MembersListResponse>(
    `/api/trips/${tripId}/members?${qs.toString()}`,
    { method: "GET" },
  );
}

export function updateMemberRole(
  tripId: string,
  userId: string,
  role: MemberRole,
): Promise<MemberUpdateResponse> {
  return apiFetch<MemberUpdateResponse>(
    `/api/trips/${tripId}/members/${userId}`,
    { method: "PATCH", body: { role } },
  );
}

export function removeMember(tripId: string, userId: string): Promise<void> {
  return apiFetch<void>(`/api/trips/${tripId}/members/${userId}`, {
    method: "DELETE",
  });
}
