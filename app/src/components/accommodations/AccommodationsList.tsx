"use client";

// B-008 — Paginated list of accommodations for a trip. Editor/owner can
// edit and delete each row; viewer is read-only. Skeleton/empty/error states
// included. Pagination uses Prev/Next buttons (matches the bookmarks/members
// pattern of simple page controls — no virtualized list needed).

import { useState } from "react";
import type { MemberRole } from "@/lib/types/domain";
import type { AccommodationWithPlace } from "@/lib/types/accommodations";
import {
  deleteAccommodation,
  useAccommodations,
} from "@/lib/hooks/useAccommodations";
import { ApiClientError } from "@/lib/utils/api-client";
import {
  computeNights,
  formatDateRange,
  pickAccommodationCost,
} from "@/lib/utils/format";
import { SkeletonCard } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { RemoveAccommodationDialog } from "./RemoveAccommodationDialog";
import { AccommodationForm } from "./AccommodationForm";

interface AccommodationsListProps {
  tripId: string;
  role: MemberRole;
  tripStartDate: string;
  tripEndDate: string;
  tripBaseCurrency: string;
  /** When the parent owns the "add" CTA, set this so the inline empty-state
   *  CTA invokes it. */
  onAddRequested?: () => void;
}

interface DeleteState {
  open: boolean;
  target?: AccommodationWithPlace;
  busy: boolean;
  error: string | null;
}

export function AccommodationsList({
  tripId,
  role,
  tripStartDate,
  tripEndDate,
  tripBaseCurrency,
  onAddRequested,
}: AccommodationsListProps) {
  const canEdit = role === "owner" || role === "editor";
  const {
    status,
    items,
    page,
    limit,
    total,
    error,
    refetch,
    setPage,
  } = useAccommodations(tripId, { limit: 20 });

  const [editing, setEditing] = useState<AccommodationWithPlace | null>(null);
  const [del, setDel] = useState<DeleteState>({
    open: false,
    busy: false,
    error: null,
  });

  async function onConfirmDelete() {
    if (!del.target) return;
    setDel((d) => ({ ...d, busy: true, error: null }));
    try {
      await deleteAccommodation(tripId, del.target.id);
      setDel({ open: false, busy: false, error: null });
      await refetch();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the accommodation. Please try again.";
      setDel((d) => ({ ...d, busy: false, error: message }));
    }
  }

  if (status === "loading") {
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-4 text-sm text-red-700 dark:text-red-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <span>{error ?? "Could not load accommodations."}</span>
        <button
          type="button"
          onClick={() => void refetch()}
          className={secondaryButtonClass}
        >
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 18V8m0 0h13a4 4 0 014 4v6m-17 0h17m-17 0v3m17-3v3M3 14h17"
            />
          </svg>
        }
        title="No accommodations yet"
        message={
          canEdit
            ? "Add your first hotel stay — check-in and check-out dates appear automatically on those days."
            : "Once accommodations are added to this trip they'll appear here."
        }
        ctaLabel={canEdit ? "Add accommodation" : undefined}
        onCtaClick={canEdit ? onAddRequested : undefined}
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      <ul className="space-y-2">
        {items.map((acc) => {
          const displayName = nameFor(acc);
          const dateRange = formatDateRange(acc.check_in_date, acc.check_out_date);
          const nights = computeNights(acc.check_in_date, acc.check_out_date);
          const cost = pickAccommodationCost(acc, nights);
          return (
            <li
              key={acc.id}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="w-5 h-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 18V8m0 0h13a4 4 0 014 4v6m-17 0h17m-17 0v3m17-3v3M3 14h17m-12-2a2 2 0 100-4 2 2 0 000 4z"
                    />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
                    {displayName}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {dateRange}
                    {nights > 0 && (
                      <>
                        {" · "}
                        {nights} {nights === 1 ? "night" : "nights"}
                      </>
                    )}
                  </p>
                  {acc.confirmation && (
                    <p className="mt-0.5 text-xs text-zinc-500 truncate">
                      Confirmation: {acc.confirmation}
                    </p>
                  )}
                  {cost && (
                    <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {cost}
                    </p>
                  )}
                  {acc.notes && (
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
                      {acc.notes}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="shrink-0 flex flex-col sm:flex-row gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(acc)}
                      className="h-8 px-3 rounded-full border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDel({
                          open: true,
                          target: acc,
                          busy: false,
                          error: null,
                        })
                      }
                      className="h-8 px-3 rounded-full border border-red-300 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500"
        >
          <span>
            Page {page} of {totalPages} · {total}{" "}
            {total === 1 ? "stay" : "stays"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className={secondaryButtonClass}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className={secondaryButtonClass}
            >
              Next
            </button>
          </div>
        </nav>
      )}

      {editing && (
        <AccommodationForm
          mode="edit"
          tripId={tripId}
          tripStartDate={tripStartDate}
          tripEndDate={tripEndDate}
          tripBaseCurrency={tripBaseCurrency}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refetch();
          }}
        />
      )}

      <RemoveAccommodationDialog
        open={del.open}
        hotelLabel={del.target ? nameFor(del.target) : ""}
        checkInDate={del.target?.check_in_date ?? ""}
        checkOutDate={del.target?.check_out_date ?? ""}
        busy={del.busy}
        error={del.error}
        onConfirm={onConfirmDelete}
        onCancel={() => {
          if (del.busy) return;
          setDel({ open: false, busy: false, error: null });
        }}
      />

    </>
  );
}

export function nameFor(acc: AccommodationWithPlace): string {
  if (acc.hotel_name && acc.hotel_name.trim().length > 0) return acc.hotel_name;
  if (acc.place?.name && acc.place.name.trim().length > 0) return acc.place.name;
  return "Accommodation";
}
