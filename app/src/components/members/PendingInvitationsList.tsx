"use client";

import { useEffect, useState } from "react";
import type { Invitation } from "@/lib/types/domain";
import { ApiClientError } from "@/lib/utils/api-client";
import { listPendingInvitations } from "@/lib/hooks/useInvitations";
import { SkeletonCard } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { formatShortDate } from "@/lib/utils/format";
import { secondaryButtonClass } from "@/components/ui/FormField";

interface PendingInvitationsListProps {
  tripId: string;
  /** Bumping this number triggers a refetch (e.g., after a new invite is created). */
  refreshKey?: number;
}

type ListState =
  | { status: "loading" }
  | { status: "ready"; items: Invitation[]; nowMs: number }
  | { status: "error"; message: string };

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

function relativeFromNow(iso: string, nowMs: number): string {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return "";
  const diffMs = target - nowMs;
  const diffMin = Math.round(diffMs / 60_000);
  const absMin = Math.abs(diffMin);
  if (absMin < 60) return RELATIVE_FORMATTER.format(diffMin, "minute");
  const diffHour = Math.round(diffMs / 3_600_000);
  const absHour = Math.abs(diffHour);
  if (absHour < 48) return RELATIVE_FORMATTER.format(diffHour, "hour");
  const diffDay = Math.round(diffMs / 86_400_000);
  return RELATIVE_FORMATTER.format(diffDay, "day");
}

export function PendingInvitationsList({
  tripId,
  refreshKey = 0,
}: PendingInvitationsListProps) {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function run() {
      try {
        const res = await listPendingInvitations(tripId);
        if (!active || controller.signal.aborted) return;
        setState({ status: "ready", items: res.items, nowMs: Date.now() });
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load invitations. Please try again.";
        setState({ status: "error", message });
      }
    }
    run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [tripId, refreshKey, retryNonce]);

  function triggerRetry() {
    setState({ status: "loading" });
    setRetryNonce((n) => n + 1);
  }

  if (state.status === "loading") {
    return (
      <div className="grid gap-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-5 text-sm text-red-700 dark:text-red-300"
      >
        {state.message}
        <div className="mt-3">
          <button
            type="button"
            onClick={triggerRetry}
            className={secondaryButtonClass}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="w-6 h-6"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        }
        title="No pending invitations"
        message="Use the form above to invite a trip partner by email."
      />
    );
  }

  const nowMs = state.nowMs;
  return (
    <ul className="grid gap-3">
      {state.items.map((inv) => {
        const expiresLabel = relativeFromNow(inv.expires_at, nowMs);
        const expired = Date.parse(inv.expires_at) < nowMs;
        return (
          <li
            key={inv.id}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">
                {inv.email}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <RoleBadge role={inv.role} />
                <span className="text-zinc-500">
                  {expired ? "Expired" : `Expires ${expiresLabel}`}
                </span>
                <span className="text-zinc-400">·</span>
                <span className="text-zinc-500">
                  Sent {formatShortDate(inv.created_at)}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RoleBadge({ role }: { role: string }) {
  const label =
    role === "editor" ? "Editor" : role === "viewer" ? "Viewer" : role;
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">
      {label}
    </span>
  );
}
