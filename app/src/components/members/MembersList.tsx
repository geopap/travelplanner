"use client";

// B-013 — Paginated list of accepted trip members. Shown to every role.
// When the viewer is the trip owner, each (non-self) row also renders
// MemberRoleControls for changing roles and removing members.

import { useEffect, useState } from "react";
import type { MemberRole } from "@/lib/types/domain";
import type { MemberWithProfile } from "@/lib/types/members";
import { ApiClientError } from "@/lib/utils/api-client";
import { listMembers } from "@/lib/hooks/useMembers";
import { SkeletonCard } from "@/components/Skeletons";
import { formatShortDate } from "@/lib/utils/format";
import { ROLE_LABEL } from "@/lib/utils/members";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { InitialsAvatar } from "@/components/profile/InitialsAvatar";
import { MemberRoleControls } from "./MemberRoleControls";

interface MembersListProps {
  tripId: string;
  /** UID of the signed-in user — used to label the self row and gate controls. */
  currentUserId: string;
  /** Owner-only controls render when true. */
  isOwner: boolean;
}

const PAGE_SIZE = 20;

type ListState =
  | { status: "loading"; page: number }
  | {
      status: "ready";
      page: number;
      items: MemberWithProfile[];
      total: number;
    }
  | { status: "error"; page: number; message: string };

function memberDisplayName(m: MemberWithProfile): string {
  return m.profile.full_name?.trim() || m.profile.email;
}

export function MembersList({
  tripId,
  currentUserId,
  isOwner,
}: MembersListProps) {
  const [state, setState] = useState<ListState>({
    status: "loading",
    page: 1,
  });
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await listMembers(tripId, state.page, PAGE_SIZE);
        if (!active) return;
        setState({
          status: "ready",
          page: res.page,
          items: res.members,
          total: res.total,
        });
      } catch (err) {
        if (!active) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load members. Please try again.";
        setState((s) => ({ status: "error", page: s.page, message }));
      }
    }
    if (state.status === "loading") run();
    return () => {
      active = false;
    };
  }, [tripId, state.status, state.page, refreshNonce]);

  function goToPage(next: number) {
    setState({ status: "loading", page: next });
  }

  function reload() {
    setRefreshNonce((n) => n + 1);
    setState((s) => ({ status: "loading", page: s.page }));
  }

  if (state.status === "loading") {
    return (
      <div className="grid gap-3">
        <SkeletonCard />
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
            onClick={reload}
            className={secondaryButtonClass}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));

  return (
    <>
      <ul className="grid gap-3">
        {state.items.map((m) => {
          const isSelf = m.user_id === currentUserId;
          const label = memberDisplayName(m);
          return (
            <li
              key={m.user_id}
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="min-w-0 flex items-center gap-3">
                <InitialsAvatar
                  name={m.profile.full_name}
                  email={m.profile.email}
                  avatarUrl={m.profile.avatar_url}
                  size={40}
                  className="shrink-0"
                />
                <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate">
                  {label}
                  {isSelf && (
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      (you)
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <RoleBadge role={m.role} />
                  {m.profile.full_name && (
                    <>
                      <span className="text-zinc-400">·</span>
                      <span className="text-zinc-500 truncate">
                        {m.profile.email}
                      </span>
                    </>
                  )}
                  {m.accepted_at && (
                    <>
                      <span className="text-zinc-400">·</span>
                      <span className="text-zinc-500">
                        Joined {formatShortDate(m.accepted_at)}
                      </span>
                    </>
                  )}
                </div>
                </div>
              </div>

              {isOwner && !isSelf && (
                <MemberRoleControls
                  tripId={tripId}
                  member={m}
                  currentUserId={currentUserId}
                  memberLabel={label}
                  onChanged={reload}
                />
              )}
              {isOwner && isSelf && (
                <span className="text-xs text-zinc-500">
                  {ROLE_LABEL[m.role]} · self
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <nav
          aria-label="Members pagination"
          className="mt-6 flex items-center justify-center gap-2"
        >
          <button
            type="button"
            disabled={state.page <= 1}
            onClick={() => goToPage(Math.max(1, state.page - 1))}
            className="h-9 px-4 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {state.page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={state.page >= totalPages}
            onClick={() => goToPage(Math.min(totalPages, state.page + 1))}
            className="h-9 px-4 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      )}
    </>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  const tone =
    role === "owner"
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
      : role === "editor"
        ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
        : "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}
