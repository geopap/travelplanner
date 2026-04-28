"use client";

// B-008 AC-5 — Trip-overview accommodations summary. Renders the first 5
// accommodations in check-in date order with name, dates and total cost.
// Links to the full accommodations tab.

import Link from "next/link";
import { useAccommodations } from "@/lib/hooks/useAccommodations";
import { SkeletonCard } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { secondaryButtonClass } from "@/components/ui/FormField";
import {
  computeNights,
  formatDateRange,
  pickAccommodationCost,
} from "@/lib/utils/format";
import { nameFor } from "./AccommodationsList";

interface AccommodationsSummaryProps {
  tripId: string;
  /** Whether the viewer can write — drives the empty-state CTA. */
  canEdit: boolean;
}

const SUMMARY_LIMIT = 5;

export function AccommodationsSummary({
  tripId,
  canEdit,
}: AccommodationsSummaryProps) {
  const { status, items, total, error, refetch } = useAccommodations(tripId, {
    limit: SUMMARY_LIMIT,
  });

  return (
    <section
      aria-labelledby="accommodations-summary-heading"
      className="mt-10"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2
          id="accommodations-summary-heading"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Accommodations
        </h2>
        {status === "ready" && total > 0 && (
          <span className="text-xs text-zinc-500">
            {total} {total === 1 ? "stay" : "stays"}
            {items.length < total && ` (showing ${items.length})`}
          </span>
        )}
      </div>

      {status === "loading" && (
        <div className="space-y-2" role="status" aria-live="polite">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {status === "error" && (
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
      )}

      {status === "ready" && items.length === 0 && (
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
              ? "Log your hotel stays to see check-in and check-out indicators on each day."
              : "Once accommodations are added they'll appear here."
          }
          ctaLabel={canEdit ? "Add accommodation" : undefined}
          ctaHref={canEdit ? `/trips/${tripId}/accommodations` : undefined}
        />
      )}

      {status === "ready" && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((acc) => {
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
                      {nameFor(acc)}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatDateRange(acc.check_in_date, acc.check_out_date)}
                      {nights > 0 && (
                        <>
                          {" · "}
                          {nights} {nights === 1 ? "night" : "nights"}
                        </>
                      )}
                    </p>
                    {cost && (
                      <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {cost}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}

          <li className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-center text-xs text-zinc-500">
            <Link
              href={`/trips/${tripId}/accommodations`}
              className="underline underline-offset-2"
            >
              {items.length < total
                ? `View all ${total} accommodations`
                : "Open accommodations"}
            </Link>
          </li>
        </ul>
      )}
    </section>
  );
}
