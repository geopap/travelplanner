"use client";

// Thin client-side wrappers around the invitation API endpoints.
// All calls go through apiFetch so error envelopes are normalized.

import { apiFetch } from "@/lib/utils/api-client";
import type { Invitation, MemberRole } from "@/lib/types/domain";

export interface CreateInvitationBody {
  email: string;
  role: Exclude<MemberRole, "owner">;
}

export interface CreateInvitationResponse {
  invitation: Invitation & { invite_url: string };
}

export interface ListInvitationsResponse {
  items: Invitation[];
  page: number;
  limit: number;
  total: number;
}

export interface AcceptInvitationResponse {
  trip_id: string;
  role: string;
}

export function createInvitation(
  tripId: string,
  body: CreateInvitationBody,
): Promise<CreateInvitationResponse> {
  return apiFetch<CreateInvitationResponse>(
    `/api/trips/${tripId}/invitations`,
    { method: "POST", body },
  );
}

export function listPendingInvitations(
  tripId: string,
  page = 1,
  limit = 20,
): Promise<ListInvitationsResponse> {
  const qs = new URLSearchParams({
    status: "pending",
    page: String(page),
    limit: String(limit),
  });
  return apiFetch<ListInvitationsResponse>(
    `/api/trips/${tripId}/invitations?${qs.toString()}`,
    { method: "GET" },
  );
}

export function acceptInvitation(
  token: string,
): Promise<AcceptInvitationResponse> {
  return apiFetch<AcceptInvitationResponse>(
    `/api/invitations/${encodeURIComponent(token)}/accept`,
    { method: "POST" },
  );
}
