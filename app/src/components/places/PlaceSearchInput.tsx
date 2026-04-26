"use client";

// Reusable Google-Places search combobox. Consumed by B-010 (place detail)
// and B-011 (bookmarks). The single integration point is the onSelect prop —
// no trip-specific or bookmark-specific behavior lives here.

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  usePlaceSearch,
  type PlaceSearchResult,
} from "@/lib/hooks/usePlaceSearch";
import { PlaceCategoryBadge } from "@/components/places/PlaceCategoryBadge";
import { inputClass } from "@/components/ui/FormField";
import { SkeletonLine } from "@/components/Skeletons";

interface PlaceSearchInputProps {
  onSelect: (place: PlaceSearchResult) => void;
  placeholder?: string;
  initialQuery?: string;
  autoFocus?: boolean;
}

export function PlaceSearchInput({
  onSelect,
  placeholder = "Search places…",
  initialQuery = "",
  autoFocus = false,
}: PlaceSearchInputProps) {
  // On selection we keep the input populated with the chosen place's name —
  // consumers (itinerary form, bookmark form) want a confirmed selection visible.
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const { results, loading, error } = usePlaceSearch(query);
  const trimmed = query.trim();
  const minMet = trimmed.length >= 2;

  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  // Reset highlight when result set changes.
  useEffect(() => {
    queueMicrotask(() => {
      setActiveIndex(results.length > 0 ? 0 : -1);
    });
  }, [results]);

  // Open dropdown whenever the query is long enough.
  useEffect(() => {
    queueMicrotask(() => {
      setOpen(minMet);
    });
  }, [minMet, query]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const node = containerRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Rate-limit countdown: tick once per second while error present.
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (error?.code === "rate_limit_exceeded") {
      const initial = error.retry_after;
      queueMicrotask(() => setCountdown(initial));
      const interval = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            window.clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => window.clearInterval(interval);
    }
    queueMicrotask(() => setCountdown(null));
    return;
  }, [error]);

  function commitSelection(place: PlaceSearchResult) {
    setQuery(place.name);
    setOpen(false);
    onSelect(place);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      if (minMet) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        commitSelection(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  }

  const showDropdown = open && minMet && error?.code !== "unauthorized";
  const activeId =
    showDropdown && activeIndex >= 0 && activeIndex < results.length
      ? optionId(activeIndex)
      : undefined;

  const errorMessage = useMemo(() => {
    if (!error) return null;
    switch (error.code) {
      case "invalid_query":
        return "Enter at least 2 characters.";
      case "rate_limit_exceeded": {
        const seconds = countdown ?? error.retry_after;
        if (seconds <= 0) return "Try your search again.";
        return `Too many searches. Try again in ${seconds}s.`;
      }
      case "places_unavailable":
      case "server_error":
        return "Search temporarily unavailable. Try again.";
      case "unauthorized":
        // Rendered inline beneath the input (dropdown is suppressed for this code).
        return null;
      default:
        return null;
    }
  }, [error, countdown]);

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        spellCheck={false}
        className={inputClass}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (minMet) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      {error?.code === "unauthorized" && (
        <p
          className="mt-1 px-1 text-sm text-zinc-600 dark:text-zinc-400"
          role="alert"
        >
          Session expired — please sign in again.
        </p>
      )}

      {showDropdown && (
        <div
          className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-lg max-h-80 overflow-auto"
        >
          {loading && (
            <div
              className="p-3 space-y-3"
              role="status"
              aria-live="polite"
              aria-label="Loading search results"
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <SkeletonLine className="h-4 w-1/2" />
                  <SkeletonLine className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          )}

          {!loading && errorMessage && (
            <p
              className="px-3 py-3 text-sm text-zinc-600 dark:text-zinc-400"
              role="alert"
            >
              {errorMessage}
            </p>
          )}

          {!loading && !errorMessage && results.length === 0 && (
            <div className="px-3 py-4 text-sm text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
              <span aria-hidden="true" className="text-base leading-none">
                🔍
              </span>
              <span>No places match &ldquo;{trimmed}&rdquo;.</span>
            </div>
          )}

          {!loading && !errorMessage && results.length > 0 && (
            <ul
              role="listbox"
              id={listboxId}
              className="py-1"
            >
              {results.map((place, i) => {
                const active = i === activeIndex;
                return (
                  <li
                    key={place.google_place_id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={active}
                    onMouseDown={(e) => {
                      // mousedown so input doesn't blur before we read it
                      e.preventDefault();
                      commitSelection(place);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`min-h-[44px] px-3 py-2 cursor-pointer flex items-start gap-3 ${
                      active
                        ? "bg-zinc-100 dark:bg-zinc-900"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {place.name}
                        </span>
                        <PlaceCategoryBadge category={place.category} />
                      </div>
                      {place.formatted_address && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                          {place.formatted_address}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
