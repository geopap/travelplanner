"use client";

// B-015 — SSR-safe collapsible wrapper around <DayMap/>.
//
// Why SSR-safe: react-leaflet/leaflet reach for `window` at module load. Next 16
// renders client components on the server during prerender, which would crash.
// We import DayMap via next/dynamic with ssr:false so the heavy module is only
// loaded in the browser AFTER hydration.
//
// State model:
// - Collapsed/expanded persisted in localStorage under
//   `tp.b015.dayMap.<tripId>.<dayId>` (default: collapsed).
// - Items without a plottable place are filtered out upstream — the section
//   itself shows a disabled "No mapped stops" header when the filtered list is
//   empty (AC 6).

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ItineraryItem } from "@/lib/types/domain";
import type { DayMapItem } from "./DayMap";

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
  items: ItineraryItem[];
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
    // Private mode / storage quota — fall back to default (collapsed).
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

export function DayMapSection({ tripId, dayId, items }: DayMapSectionProps) {
  // Pre-filter to plottable items. The list endpoint already nulls `place`
  // when coords are missing, so we just need `place !== null`.
  const mapped: DayMapItem[] = useMemo(
    () =>
      items.flatMap((it) => {
        const p = it.place;
        if (!p || p.lat === null || p.lng === null) return [];
        return [
          {
            id: it.id,
            title: it.title,
            start_time: it.start_time,
            place: { lat: p.lat, lng: p.lng },
          },
        ];
      }),
    [items],
  );

  // Lazy-read initial state from localStorage. Defer until mount so SSR HTML
  // matches the client default (collapsed).
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setOpen(readInitialOpen(tripId, dayId));
    setHydrated(true);
  }, [tripId, dayId]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      persistOpen(tripId, dayId, next);
      return next;
    });
  }, [tripId, dayId]);

  // Empty state — non-interactive header per AC 6.
  if (mapped.length === 0) {
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

  const countLabel = `${mapped.length} ${mapped.length === 1 ? "stop" : "stops"}`;

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
          Map <span className="text-zinc-500 dark:text-zinc-400">·</span>{" "}
          {countLabel}
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
          {/* Pass `mapped` whose array identity changes when items change,
              so DayMap's FitBounds re-runs on re-open / data refresh. */}
          <DayMap items={mapped} />
        </div>
      )}
    </section>
  );
}
