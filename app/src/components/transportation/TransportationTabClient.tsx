"use client";

import { useCallback, useEffect, useState } from "react";
import type { ItineraryItem, MemberRole, TripDay } from "@/lib/types/domain";
import type {
  Transportation,
  TransportationWithItem,
  TransportMode,
} from "@/lib/types/transportation";
import { useTransportation } from "@/lib/hooks/useTransportation";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";
import { SkeletonCard } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/FormField";
import { ItineraryItemForm } from "@/components/itinerary/ItineraryItemForm";

interface Props {
  tripId: string;
  role: MemberRole;
  tripBaseCurrency: string;
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
  other: {
    icon: "🧭",
    label: "Other",
    tone: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  },
};

interface EditTarget {
  item: ItineraryItem;
  transportation: Transportation | null;
  dayId: string;
  dayDate: string;
}

interface CreateTarget {
  dayId: string;
  dayDate: string;
}

interface DeleteState {
  open: boolean;
  target?: TransportationWithItem;
  busy: boolean;
  error: string | null;
}

export function TransportationTabClient({
  tripId,
  role,
  tripBaseCurrency,
}: Props) {
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
  } = useTransportation(tripId, { limit: 20 });

  const [days, setDays] = useState<TripDay[] | null>(null);
  const [daysError, setDaysError] = useState<string | null>(null);

  const [creating, setCreating] = useState<CreateTarget | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [editLoading, setEditLoading] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [del, setDel] = useState<DeleteState>({
    open: false,
    busy: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch<{ items: TripDay[] }>(
          `/api/trips/${encodeURIComponent(tripId)}/days`,
          { method: "GET" },
        );
        if (cancelled) return;
        setDays(data.items);
      } catch (err) {
        if (cancelled) return;
        setDaysError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load trip days.",
        );
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const onClickAdd = useCallback(() => {
    if (!days || days.length === 0) return;
    const first = days[0]!;
    setCreating({ dayId: first.id, dayDate: first.date });
  }, [days]);

  const openEdit = useCallback(
    async (row: TransportationWithItem) => {
      if (!row.item.day_id || !days) return;
      const day = days.find((d) => d.id === row.item.day_id);
      if (!day) {
        setEditError("Could not resolve the day for this segment.");
        return;
      }
      setEditError(null);
      setEditLoading(row.id);
      try {
        const data = await apiFetch<{
          item: ItineraryItem;
          transportation: Transportation | null;
        }>(
          `/api/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(row.item.id)}`,
          { method: "GET" },
        );
        setEditing({
          item: data.item,
          transportation: data.transportation ?? null,
          dayId: day.id,
          dayDate: day.date,
        });
      } catch (err) {
        setEditError(
          err instanceof ApiClientError
            ? err.message
            : "Could not load this segment.",
        );
      } finally {
        setEditLoading(null);
      }
    },
    [days, tripId],
  );

  async function onConfirmDelete() {
    if (!del.target) return;
    setDel((d) => ({ ...d, busy: true, error: null }));
    try {
      await apiFetch<void>(
        `/api/trips/${encodeURIComponent(tripId)}/items/${encodeURIComponent(del.target.item.id)}`,
        { method: "DELETE" },
      );
      setDel({ open: false, busy: false, error: null });
      await refetch();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the segment. Please try again.";
      setDel((d) => ({ ...d, busy: false, error: message }));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={onClickAdd}
            disabled={!days || days.length === 0}
            className={primaryButtonClass}
          >
            Add transport
          </button>
        </div>
      )}

      {daysError && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          {daysError}
        </div>
      )}
      {editError && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300"
        >
          {editError}
        </div>
      )}

      {status === "loading" && (
        <div className="space-y-3" role="status" aria-live="polite">
          <SkeletonCard />
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
              ? "Add a transport segment — flight, train, ferry or other — and it'll show up here in departure order."
              : "Once transport segments are added to this trip they'll appear here."
          }
          ctaLabel={canEdit ? "Add transport" : undefined}
          onCtaClick={canEdit ? onClickAdd : undefined}
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
                  {canEdit && (
                    <div className="shrink-0 flex flex-col sm:flex-row gap-1">
                      <button
                        type="button"
                        onClick={() => void openEdit(row)}
                        disabled={editLoading === row.id || !days}
                        className="h-8 px-3 rounded-full border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {editLoading === row.id ? "Loading…" : "Edit"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDel({
                            open: true,
                            target: row,
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
      )}

      {status === "ready" && totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500"
        >
          <span>
            Page {page} of {totalPages} · {total}{" "}
            {total === 1 ? "segment" : "segments"}
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

      {creating && (
        <ItineraryItemForm
          mode="create"
          tripId={tripId}
          dayId={creating.dayId}
          dayDate={creating.dayDate}
          tripBaseCurrency={tripBaseCurrency}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            void refetch();
          }}
        />
      )}

      {editing && (
        <ItineraryItemForm
          mode="edit"
          tripId={tripId}
          dayId={editing.dayId}
          dayDate={editing.dayDate}
          tripBaseCurrency={tripBaseCurrency}
          initial={editing.item}
          initialTransportation={editing.transportation}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refetch();
          }}
        />
      )}

      <ConfirmDeleteDialog
        open={del.open}
        title="Delete this transport segment?"
        description={
          del.target
            ? `“${del.target.item.title}” will be removed from the itinerary.`
            : ""
        }
        confirmLabel="Delete"
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
