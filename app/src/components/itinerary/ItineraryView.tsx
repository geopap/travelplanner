"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ItineraryItem,
  MemberRole,
  Paginated,
  Trip,
  TripDay,
} from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { SkeletonDay } from "@/components/Skeletons";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { DayCard } from "./DayCard";
import { ItineraryItemForm } from "./ItineraryItemForm";

interface ItineraryViewProps {
  tripId: string;
}

interface TripDetailResponse {
  trip: Trip;
  member: { role: MemberRole };
}

interface DrawerState {
  open: boolean;
  dayId: string;
  dayDate: string;
  mode: "create" | "edit";
  initial?: ItineraryItem;
}

interface DeleteState {
  open: boolean;
  item?: ItineraryItem;
  busy: boolean;
  error: string | null;
}

const ITEMS_PAGE_SIZE = 200;

export function ItineraryView({ tripId }: ItineraryViewProps) {
  const [loadState, setLoadState] = useState<
    | { status: "loading" }
    | {
        status: "ready";
        trip: Trip;
        role: MemberRole;
        days: TripDay[];
        itemsByDay: Record<string, ItineraryItem[]>;
        loadedCount: number;
        totalCount: number;
        nextPage: number;
      }
    | { status: "error"; message: string }
  >({ status: "loading" });

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [del, setDel] = useState<DeleteState>({
    open: false,
    busy: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // All three fetches are independent — run fully in parallel.
        const [detail, daysRes, itemsRes] = await Promise.all([
          apiFetch<TripDetailResponse>(`/api/trips/${tripId}`, {
            method: "GET",
          }),
          apiFetch<{ items: TripDay[] }>(`/api/trips/${tripId}/days`, {
            method: "GET",
          }),
          apiFetch<Paginated<ItineraryItem>>(
            `/api/trips/${tripId}/items?page=1&limit=${ITEMS_PAGE_SIZE}`,
            { method: "GET" },
          ),
        ]);
        if (cancelled) return;

        const days = [...daysRes.items].sort(
          (a, b) => a.day_number - b.day_number,
        );

        const itemsByDay: Record<string, ItineraryItem[]> = {};
        for (const day of days) itemsByDay[day.id] = [];
        for (const item of itemsRes.items) {
          if (item.day_id && itemsByDay[item.day_id]) {
            itemsByDay[item.day_id].push(item);
          }
        }
        // Sort each day: start_time asc, nulls last, then created_at asc
        for (const id of Object.keys(itemsByDay)) {
          itemsByDay[id].sort(compareItems);
        }

        setLoadState({
          status: "ready",
          trip: detail.trip,
          role: detail.member.role,
          days,
          itemsByDay,
          loadedCount: itemsRes.items.length,
          totalCount: itemsRes.total,
          nextPage: 2,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError && err.status === 404
            ? "Trip not found or you no longer have access."
            : err instanceof ApiClientError
            ? err.message
            : "Could not load the itinerary. Please try again.";
        setLoadState({ status: "error", message });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const loadMore = useCallback(async () => {
    if (loadState.status !== "ready") return;
    if (loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = loadState.nextPage;
      const res = await apiFetch<Paginated<ItineraryItem>>(
        `/api/trips/${tripId}/items?page=${page}&limit=${ITEMS_PAGE_SIZE}`,
        { method: "GET" },
      );
      setLoadState((s) => {
        if (s.status !== "ready") return s;
        const next: Record<string, ItineraryItem[]> = { ...s.itemsByDay };
        for (const item of res.items) {
          if (item.day_id && next[item.day_id]) {
            // Avoid duplicates if the same item was already loaded.
            if (!next[item.day_id].some((i) => i.id === item.id)) {
              next[item.day_id] = [...next[item.day_id], item];
            }
          }
        }
        for (const id of Object.keys(next)) {
          next[id] = [...next[id]].sort(compareItems);
        }
        return {
          ...s,
          itemsByDay: next,
          loadedCount: s.loadedCount + res.items.length,
          totalCount: res.total,
          nextPage: page + 1,
        };
      });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not load more items. Please try again.";
      setLoadMoreError(message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadState, loadingMore, tripId]);

  const onDayTitleChange = useCallback(
    (dayId: string, title: string | null) => {
      setLoadState((s) => {
        if (s.status !== "ready") return s;
        return {
          ...s,
          days: s.days.map((d) =>
            d.id === dayId ? { ...d, title } : d,
          ),
        };
      });
    },
    [],
  );

  function openCreate(dayId: string) {
    if (loadState.status !== "ready") return;
    const day = loadState.days.find((d) => d.id === dayId);
    if (!day) return;
    setDrawer({ open: true, dayId, dayDate: day.date, mode: "create" });
  }

  function openEdit(dayId: string, item: ItineraryItem) {
    if (loadState.status !== "ready") return;
    const day = loadState.days.find((d) => d.id === dayId);
    if (!day) return;
    setDrawer({
      open: true,
      dayId,
      dayDate: day.date,
      mode: "edit",
      initial: item,
    });
  }

  function onSaved(item: ItineraryItem) {
    setLoadState((s) => {
      if (s.status !== "ready") return s;
      const targetDayId = item.day_id ?? drawer?.dayId ?? "";
      const next: Record<string, ItineraryItem[]> = { ...s.itemsByDay };

      // Remove from previous day lists if it was there (handles day reassign).
      for (const id of Object.keys(next)) {
        next[id] = next[id].filter((i) => i.id !== item.id);
      }
      if (targetDayId && next[targetDayId]) {
        next[targetDayId] = [...next[targetDayId], item].sort(compareItems);
      }

      return { ...s, itemsByDay: next };
    });
    setDrawer(null);
  }

  async function onConfirmDelete() {
    if (!del.item) return;
    setDel((d) => ({ ...d, busy: true, error: null }));
    try {
      await apiFetch<void>(
        `/api/trips/${tripId}/items/${del.item.id}`,
        { method: "DELETE" },
      );
      setLoadState((s) => {
        if (s.status !== "ready" || !del.item) return s;
        const itemId = del.item.id;
        const next: Record<string, ItineraryItem[]> = {};
        for (const id of Object.keys(s.itemsByDay)) {
          next[id] = s.itemsByDay[id].filter((i) => i.id !== itemId);
        }
        return { ...s, itemsByDay: next };
      });
      setDel({ open: false, busy: false, error: null });
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the item. Please try again.";
      setDel((d) => ({ ...d, busy: false, error: message }));
    }
  }

  const daySidebarItems = useMemo(() => {
    if (loadState.status !== "ready") return [];
    return loadState.days.map((d) => ({
      id: d.id,
      day_number: d.day_number,
      date: d.date,
      title: d.title,
    }));
  }, [loadState]);

  if (loadState.status === "loading") {
    return (
      <div className="space-y-4">
        <SkeletonDay />
        <SkeletonDay />
        <SkeletonDay />
      </div>
    );
  }

  if (loadState.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-5 text-sm text-red-700 dark:text-red-300"
      >
        {loadState.message}
        <div className="mt-3">
          <Link href="/trips" className={secondaryButtonClass}>
            Back to trips
          </Link>
        </div>
      </div>
    );
  }

  const { trip, role, days, itemsByDay, loadedCount, totalCount } = loadState;
  const hasMore = loadedCount < totalCount;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <Link
            href={`/trips/${trip.id}`}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← {trip.name}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mt-1">
            Itinerary
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
            {days.length} {days.length === 1 ? "day" : "days"} total
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav
          aria-label="Day picker"
          className="hidden lg:block sticky top-6 self-start max-h-[80vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2"
        >
          <ul className="space-y-0.5">
            {daySidebarItems.map((d) => (
              <li key={d.id}>
                <a
                  href={`#day-${d.day_number}`}
                  className="block rounded-lg px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="font-medium">Day {d.day_number}</span>
                  <span className="block text-xs text-zinc-500 truncate">
                    {d.title && d.title.trim().length > 0 ? d.title : d.date}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-4">
          {days.map((day) => (
            <DayCard
              key={day.id}
              day={day}
              items={itemsByDay[day.id] ?? []}
              role={role}
              onTitleChange={onDayTitleChange}
              onAddItem={openCreate}
              onEditItem={openEdit}
              onDeleteItem={(_, item) =>
                setDel({
                  open: true,
                  item,
                  busy: false,
                  error: null,
                })
              }
            />
          ))}

          {hasMore && (
            <div
              role="status"
              className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 p-4 text-sm text-zinc-700 dark:text-zinc-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <span>
                Showing {loadedCount} of {totalCount} items
              </span>
              <div className="flex flex-col sm:items-end gap-1">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className={secondaryButtonClass}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
                {loadMoreError && (
                  <span
                    role="alert"
                    className="text-xs text-red-600 dark:text-red-400"
                  >
                    {loadMoreError}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {drawer?.open && (
        <ItineraryItemForm
          mode={drawer.mode}
          tripId={trip.id}
          dayId={drawer.dayId}
          dayDate={drawer.dayDate}
          tripBaseCurrency={trip.base_currency}
          initial={drawer.initial}
          onClose={() => setDrawer(null)}
          onSaved={onSaved}
        />
      )}

      <ConfirmDeleteDialog
        open={del.open}
        title="Delete this item?"
        description={
          del.item
            ? `“${del.item.title}” will be removed from this day.`
            : "This item will be removed."
        }
        confirmLabel="Delete item"
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

function compareItems(a: ItineraryItem, b: ItineraryItem): number {
  const aStart = a.start_time ? Date.parse(a.start_time) : Number.POSITIVE_INFINITY;
  const bStart = b.start_time ? Date.parse(b.start_time) : Number.POSITIVE_INFINITY;
  if (aStart !== bStart) return aStart - bStart;
  return a.created_at.localeCompare(b.created_at);
}
