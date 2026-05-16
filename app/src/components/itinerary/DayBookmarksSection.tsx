"use client";

/**
 * B-031 — "Bookmarks for this day" passive read-only section on day card.
 *
 * Mirrors `DayMapSection`:
 *   - Lazy fetch on first expand (no SSR; below-the-fold on mobile).
 *   - Collapsed/expanded state persisted to localStorage.
 *   - Default collapsed on `<md`, default expanded on `md+` (the localStorage
 *     value, when present, wins over the size-based default — matches map).
 *
 * Behaviour:
 *   - Section is hidden entirely when zero paired bookmarks exist (AC 1 + 8).
 *   - Each row: category badge, name (or notes fallback), formatted address.
 *   - Row click → `/places/<google_place_id>?trip=<tripId>` (AC 3).
 *   - Rows whose bookmark has `place_id === null` render muted and are NOT
 *     clickable (AC 3 — no broken `/places/null` link). Marked aria-disabled
 *     to expose the muted state to screen readers.
 *   - Read-only for all roles (AC 6).
 *
 * Endpoint: `GET /api/trips/[id]/days/[dayId]/bookmarks`.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import type { BookmarkCategory } from "@/lib/types/domain";

import type {
  DayBookmarkRow,
  DayBookmarksResponse,
} from "@/app/api/trips/[id]/days/[dayId]/bookmarks/route";

interface DayBookmarksSectionProps {
  tripId: string;
  dayId: string;
}

const CATEGORY_LABELS: Record<BookmarkCategory, string> = {
  restaurant: "Restaurant",
  sight: "Sight",
  museum: "Museum",
  shopping: "Shopping",
  other: "Other",
};

const CATEGORY_COLORS: Record<BookmarkCategory, string> = {
  restaurant:
    "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  sight: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  museum:
    "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  shopping: "bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-200",
  other: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

function storageKey(tripId: string, dayId: string): string {
  return `tp.b031.dayBookmarks.${tripId}.${dayId}`;
}

function readStoredOpen(tripId: string, dayId: string): "1" | "0" | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(storageKey(tripId, dayId));
    if (v === "1" || v === "0") return v;
    return null;
  } catch {
    return null;
  }
}

function persistOpen(tripId: string, dayId: string, open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(tripId, dayId), open ? "1" : "0");
  } catch {
    // Collapse state is non-critical.
  }
}

/** Default open: md+ defaults to expanded, <md defaults to collapsed. */
function readDefaultOpen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(min-width: 768px)").matches;
  } catch {
    return false;
  }
}

/**
 * Fallback display name when the bookmark has no linked place. Matches the
 * convention used by `BookmarkItem` — first segment of `notes` split on " — ",
 * else a generic placeholder.
 */
function fallbackName(row: DayBookmarkRow): string {
  const seg = row.notes?.split(" — ")[0]?.trim();
  return seg && seg.length > 0 ? seg : "Untitled place";
}

export function DayBookmarksSection({
  tripId,
  dayId,
}: DayBookmarksSectionProps) {
  // Mirror DayMapSection: SSR renders collapsed; hydrate to the real value.
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const stored = readStoredOpen(tripId, dayId);
    setOpen(stored === null ? readDefaultOpen() : stored === "1");
    setHydrated(true);
  }, [tripId, dayId]);

  const [data, setData] = useState<DayBookmarksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      const key = `${tripId}/${dayId}`;
      setLoading(true);
      setLoadError(null);
      try {
        const res = await apiFetch<DayBookmarksResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(
            dayId,
          )}/bookmarks`,
          { signal },
        );
        if (signal?.aborted) return;
        fetchedKeyRef.current = key;
        setData(res);
      } catch (err) {
        if (
          signal?.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load bookmarks for this day.";
        setLoadError(message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tripId, dayId],
  );

  // We need the count to decide whether to render the section AT ALL (AC 8).
  // That requires a request even while collapsed. Fetch eagerly once hydrated.
  useEffect(() => {
    if (!hydrated) return;
    const key = `${tripId}/${dayId}`;
    if (fetchedKeyRef.current === key) return;
    const controller = new AbortController();
    abortRef.current = controller;
    void fetchData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [hydrated, tripId, dayId, fetchData]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      persistOpen(tripId, dayId, next);
      return next;
    });
  }, [tripId, dayId]);

  // Hide entirely when N = 0 (AC 1, AC 8). Also hide while initial fetch is
  // in flight — we don't render a placeholder header to keep the card clean.
  const bookmarks = data?.bookmarks ?? [];
  if (data === null && !loadError) return null; // initial load — invisible
  if (loadError) {
    return (
      <section
        aria-label="Bookmarks for this day"
        className="mt-4 rounded-lg border border-red-200 dark:border-red-900"
      >
        <div
          role="alert"
          className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-red-700 dark:text-red-300"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              const c = new AbortController();
              abortRef.current = c;
              void fetchData(c.signal);
            }}
            className="text-xs font-medium underline underline-offset-2 hover:no-underline"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }
  if (bookmarks.length === 0) return null;

  return (
    <section
      aria-label="Bookmarks for this day"
      className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`day-bookmarks-${dayId}`}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/60 rounded-t-lg"
      >
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Bookmarks for this day{" "}
          <span className="text-zinc-500 dark:text-zinc-400">
            ({bookmarks.length})
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <ul id={`day-bookmarks-${dayId}`} className="p-2 pt-0 space-y-1.5">
          {bookmarks.map((b) => (
            <BookmarkRow key={b.id} row={b} tripId={tripId} />
          ))}
          {loading && (
            <li
              role="status"
              aria-label="Refreshing bookmarks"
              className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60"
            />
          )}
        </ul>
      )}
    </section>
  );
}

interface BookmarkRowProps {
  row: DayBookmarkRow;
  tripId: string;
}

function BookmarkRow({ row, tripId }: BookmarkRowProps) {
  const name = row.place?.name ?? fallbackName(row);
  const address = row.place?.formatted_address ?? null;
  const href = row.place
    ? `/places/${encodeURIComponent(row.place.google_place_id)}?trip=${encodeURIComponent(tripId)}`
    : null;

  const badge = (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[row.category]}`}
      aria-label={`Category: ${CATEGORY_LABELS[row.category]}`}
    >
      {CATEGORY_LABELS[row.category]}
    </span>
  );

  const body = (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {name}
      </span>
      {address && (
        <span
          className="block truncate text-xs text-zinc-500 dark:text-zinc-400"
          title={address}
        >
          {address}
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <li>
        <Link
          href={href}
          className="flex items-center gap-2 rounded-md p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        >
          {badge}
          {body}
        </Link>
      </li>
    );
  }

  // place_id === null — render muted, non-clickable. Marked aria-disabled so
  // assistive tech announces the "no link available" state.
  return (
    <li>
      <div
        aria-disabled="true"
        title="Not linked to a place"
        className="flex items-center gap-2 rounded-md p-2 opacity-70"
      >
        {badge}
        {body}
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          no google place
        </span>
      </div>
    </li>
  );
}
