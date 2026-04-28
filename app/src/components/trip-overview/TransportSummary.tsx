"use client";

// B-007 — Trip-overview transport summary section.
// Lists every transport segment for a trip in departure-time order.
// Server returns rows already ordered by departure_time asc nulls last.

import Link from "next/link";
import type { TransportMode } from "@/lib/types/transportation";
import { useTransportation } from "@/lib/hooks/useTransportation";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";
import { SkeletonCard } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { secondaryButtonClass } from "@/components/ui/FormField";

interface TransportSummaryProps {
  tripId: string;
  /** Whether the viewer can write — drives the empty-state CTA. */
  canEdit: boolean;
}

const MODE_META: Record<
  TransportMode,
  { icon: string; label: string; tone: string }
> = {
  flight: {
    icon: "✈",
    label: "Flight",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  },
  train: {
    icon: "🚆",
    label: "Train",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  bus: {
    icon: "🚌",
    label: "Bus",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  },
  car: {
    icon: "🚗",
    label: "Car",
    tone: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  },
  ferry: {
    icon: "⛴",
    label: "Ferry",
    tone: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  },
};

export function TransportSummary({ tripId, canEdit }: TransportSummaryProps) {
  const { status, items, total, error, refetch } = useTransportation(tripId, {
    limit: 20,
  });

  return (
    <section
      aria-labelledby="transport-summary-heading"
      className="mt-10"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2
          id="transport-summary-heading"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Transport
        </h2>
        {status === "ready" && total > 0 && (
          <span className="text-xs text-zinc-500">
            {total} {total === 1 ? "segment" : "segments"}
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
          <span>{error ?? "Could not load transport segments."}</span>
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
                d="M3 12h13l-3-3m3 3l-3 3M21 6v12"
              />
            </svg>
          }
          title="No transport segments yet"
          message={
            canEdit
              ? "Add a transport item to your itinerary — flights, trains, ferries — and they'll show up here in departure order."
              : "Once transport segments are added to this trip's itinerary they'll appear here."
          }
          ctaLabel={canEdit ? "Open itinerary" : undefined}
          ctaHref={canEdit ? `/trips/${tripId}/itinerary` : undefined}
        />
      )}

      {status === "ready" && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((row) => {
            const meta = MODE_META[row.mode];
            const fromTo =
              row.departure_location && row.arrival_location
                ? `${row.departure_location} → ${row.arrival_location}`
                : row.departure_location || row.arrival_location || "";
            const departure = formatDateTime(row.departure_time);
            const arrival = formatDateTime(row.arrival_time);
            const cost =
              row.cost !== null
                ? formatCurrency(row.cost, row.currency)
                : null;

            return (
              <li
                key={row.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base ${meta.tone}`}
                    aria-label={meta.label}
                  >
                    {meta.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.tone}`}
                      >
                        {meta.label}
                      </span>
                      {row.carrier && (
                        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {row.carrier}
                        </span>
                      )}
                      {row.confirmation && (
                        <span className="text-xs text-zinc-500">
                          · {row.confirmation}
                        </span>
                      )}
                    </div>
                    {fromTo && (
                      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300 break-words">
                        {fromTo}
                      </p>
                    )}
                    {(departure || arrival) && (
                      <p className="mt-1 text-xs text-zinc-500">
                        {departure && (
                          <>
                            <span className="font-medium text-zinc-600 dark:text-zinc-400">
                              Dep:
                            </span>{" "}
                            <time dateTime={row.departure_time ?? undefined}>
                              {departure}
                            </time>
                          </>
                        )}
                        {departure && arrival && " · "}
                        {arrival && (
                          <>
                            <span className="font-medium text-zinc-600 dark:text-zinc-400">
                              Arr:
                            </span>{" "}
                            <time dateTime={row.arrival_time ?? undefined}>
                              {arrival}
                            </time>
                          </>
                        )}
                      </p>
                    )}
                    {row.item.title && (
                      <p className="mt-1 text-xs text-zinc-500 truncate">
                        Item: {row.item.title}
                      </p>
                    )}
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

          {items.length < total && (
            <li className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-3 text-center text-xs text-zinc-500">
              Showing first {items.length} of {total}.{" "}
              <Link
                href={`/trips/${tripId}/itinerary`}
                className="underline underline-offset-2"
              >
                Open itinerary
              </Link>{" "}
              for the full list.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
