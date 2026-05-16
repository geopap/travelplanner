"use client";

// B-015 / B-023 — SSR-safe collapsible wrapper around <DayMap/>.
//
// Why SSR-safe: react-leaflet/leaflet reach for `window` at module load. Next 16
// renders client components on the server during prerender, which would crash.
// We import DayMap via next/dynamic with ssr:false so the heavy module is only
// loaded in the browser AFTER hydration.
//
// Data source (B-023): the section fetches `/api/trips/[id]/days/[dayId]/map`
// when first expanded and surfaces both itinerary items and accommodations as
// markers. The empty-state header only shows when BOTH lists are empty.
//
// State model:
// - Collapsed/expanded persisted in localStorage under
//   `tp.b015.dayMap.<tripId>.<dayId>` (default: collapsed).

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import type {
  DayMapResponse,
  AccommodationMapMarker,
  DayMapItineraryItem,
} from "@/lib/types/accommodations";
import { formatAccommodationPopupLabel } from "@/lib/utils/accommodation-indicators";
import type { DayMapItem, DayMapAccommodation } from "./DayMap";

const DayMap = dynamic(() => import("./DayMap"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-label="Loading map"
      className="h-72 sm:h-96 w-full animate-pulse rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800/60"
    />
  ),
});

interface DayMapSectionProps {
  tripId: string;
  dayId: string;
  /** Day date (ISO YYYY-MM-DD). Used by accommodation popups for the
   *  `in_stay` / `same_day` label context (not a fetch param — the endpoint
   *  is keyed by dayId server-side). */
  dayDate: string;
}

function storageKey(tripId: string, dayId: string): string {
  return `tp.b015.dayMap.${tripId}.${dayId}`;
}

function readInitialOpen(tripId: string, dayId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(storageKey(tripId, dayId));
    return v === "1";
  } catch {
    return false;
  }
}

function persistOpen(tripId: string, dayId: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tripId, dayId), open ? "1" : "0");
  } catch {
    // Swallow — collapse state is not critical.
  }
}

/** Drop unplottable items (place null) to match B-015's invariant. */
function toMapItems(items: DayMapItineraryItem[]): DayMapItem[] {
  return items.flatMap((it) => {
    const p = it.place;
    if (!p) return [];
    return [
      {
        id: it.id,
        title: it.title,
        start_time: it.start_time,
        place: { lat: p.lat, lng: p.lng },
      },
    ];
  });
}

/** Project map-endpoint accommodation rows into the DayMap marker shape. */
function toMapAccommodations(
  rows: AccommodationMapMarker[],
  dayDate: string,
): DayMapAccommodation[] {
  return rows.map((row) => ({
    id: row.accommodation_id,
    hotelName: row.hotel_name,
    popupLabel: formatAccommodationPopupLabel({
      indicator_type: row.indicator_type,
      check_in_date: row.check_in_date,
      check_out_date: row.check_out_date,
      day_date: dayDate,
    }),
    place: { lat: row.place.lat, lng: row.place.lng },
  }));
}

export function DayMapSection({ tripId, dayId, dayDate }: DayMapSectionProps) {
  // Lazy-read initial state from localStorage. Defer until mount so SSR HTML
  // matches the client default (collapsed).
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setOpen(readInitialOpen(tripId, dayId));
    setHydrated(true);
  }, [tripId, dayId]);

  // Data: fetched on first expand. Re-fetch when (tripId, dayId) changes.
  const [data, setData] = useState<DayMapResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedKeyRef = useRef<string | null>(null);

  // Track the in-flight controller so we can abort on unmount or key change.
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      const key = `${tripId}/${dayId}`;
      setLoading(true);
      setLoadError(null);
      try {
        const res = await apiFetch<DayMapResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(
            dayId,
          )}/map`,
          { signal },
        );
        if (signal?.aborted) return;
        fetchedKeyRef.current = key;
        setData(res);
      } catch (err) {
        // Bail silently on abort — component unmounted or (tripId, dayId) changed.
        if (
          signal?.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load the map for this day.";
        setLoadError(message);
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [tripId, dayId],
  );

  // Fetch on first expand for this (tripId, dayId). If the key changed
  // (parent swapped trip/day) the cached data is stale — refetch.
  useEffect(() => {
    if (!open || !hydrated) return;
    const key = `${tripId}/${dayId}`;
    if (fetchedKeyRef.current === key) return;
    const controller = new AbortController();
    abortRef.current = controller;
    void fetchData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [open, hydrated, tripId, dayId, fetchData]);

  const mappedItems = useMemo<DayMapItem[]>(
    () => (data ? toMapItems(data.items) : []),
    [data],
  );
  const mappedAccommodations = useMemo<DayMapAccommodation[]>(
    () => (data ? toMapAccommodations(data.accommodations, dayDate) : []),
    [data, dayDate],
  );

  const totalMarkers = mappedItems.length + mappedAccommodations.length;
  const bothEmpty = data !== null && totalMarkers === 0;

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      persistOpen(tripId, dayId, next);
      return next;
    });
  }, [tripId, dayId]);

  // Empty state — only when we've loaded the data and there is nothing to plot.
  if (bothEmpty) {
    return (
      <section
        aria-label="Map"
        className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Map
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            No mapped stops for this day.
          </span>
        </div>
      </section>
    );
  }

  const countLabel = (() => {
    if (data === null) return null;
    const parts: string[] = [];
    if (mappedItems.length > 0) {
      parts.push(`${mappedItems.length} ${mappedItems.length === 1 ? "stop" : "stops"}`);
    }
    if (mappedAccommodations.length > 0) {
      parts.push(
        `${mappedAccommodations.length} ${
          mappedAccommodations.length === 1 ? "hotel" : "hotels"
        }`,
      );
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  })();

  return (
    <section
      aria-label="Map"
      className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60 rounded-t-lg"
      >
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Map
          {countLabel && (
            <>
              {" "}
              <span className="text-zinc-500 dark:text-zinc-400">·</span>{" "}
              {countLabel}
            </>
          )}
        </span>
        <span
          aria-hidden="true"
          className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && hydrated && (
        <div className="p-2 pt-0">
          {loading && data === null && (
            <div
              role="status"
              aria-label="Loading map"
              className="h-72 sm:h-96 w-full animate-pulse rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800/60"
            />
          )}
          {loadError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between gap-3"
            >
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  const controller = new AbortController();
                  abortRef.current = controller;
                  void fetchData(controller.signal);
                }}
                className="text-xs font-medium underline underline-offset-2 hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}
          {data !== null && totalMarkers > 0 && (
            <DayMap items={mappedItems} accommodations={mappedAccommodations} />
          )}
        </div>
      )}
    </section>
  );
}
