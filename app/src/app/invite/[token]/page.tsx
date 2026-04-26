import { headers } from "next/headers";
import type { InvitationStatus } from "@/lib/types/domain";
import { getSessionUser } from "@/lib/supabase/server";
import { InviteAcceptCard } from "@/components/members/InviteAcceptCard";
import { InviteErrorState } from "@/components/members/InviteErrorState";
import { InviteUnauthenticatedActions } from "@/components/auth/InviteUnauthenticatedActions";

export const metadata = { title: "Trip invitation · TravelPlanner" };
export const dynamic = "force-dynamic";

interface LookupResponse {
  status: InvitationStatus;
  trip_name?: string | null;
  inviter_name?: string | null;
  role?: string | null;
  expires_at?: string | null;
  email?: string | null;
}

const VALID_STATUSES: readonly InvitationStatus[] = [
  "pending",
  "expired",
  "used",
  "revoked",
  "invalid",
];

function isInvitationStatus(value: unknown): value is InvitationStatus {
  return (
    typeof value === "string" &&
    (VALID_STATUSES as readonly string[]).includes(value)
  );
}

async function resolveSiteOrigin(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

async function fetchInvitation(token: string): Promise<LookupResponse | null> {
  try {
    const origin = await resolveSiteOrigin();
    const url = `${origin}/api/invitations/${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (
      typeof json !== "object" ||
      json === null ||
      !isInvitationStatus((json as { status?: unknown }).status)
    ) {
      return null;
    }
    return json as LookupResponse;
  } catch {
    return null;
  }
}

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const lookup = await fetchInvitation(token);
  if (!lookup) {
    return <InviteErrorState variant="invalid" />;
  }

  if (
    lookup.status === "expired" ||
    lookup.status === "used" ||
    lookup.status === "revoked" ||
    lookup.status === "invalid"
  ) {
    return <InviteErrorState variant={lookup.status} />;
  }

  // status === "pending"
  const tripName = lookup.trip_name ?? "this trip";
  const inviterName = lookup.inviter_name ?? "A trip owner";
  const role = lookup.role ?? "viewer";
  const expiresAt = lookup.expires_at ?? new Date().toISOString();

  const { user } = await getSessionUser();
  if (!user) {
    const next = `/invite/${encodeURIComponent(token)}`;
    const inviteEmail = lookup.email ?? null;
    return (
      <div className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
          You have been invited
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {tripName}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {inviterName}
          </span>{" "}
          invited you to collaborate. Sign in or create an account to accept.
        </p>
        <InviteUnauthenticatedActions
          token={token}
          email={inviteEmail}
          next={next}
        />
      </div>
    );
  }

  return (
    <InviteAcceptCard
      token={token}
      tripName={tripName}
      role={role}
      inviterName={inviterName}
      expiresAt={expiresAt}
    />
  );
}
