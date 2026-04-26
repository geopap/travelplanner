"use client";

// B-011 — Trip picker shown when the user clicks "Bookmark" on a place page.
// Fetches the current user's trips via GET /api/trips. RLS returns only
// trips the user is a member of. When the API surfaces a `role`, we filter
// to owner|editor; if absent, we show all returned trips and rely on the
// server-side write check (POST returns 403 forbidden for viewers, which
// the form maps to "You don't have permission").

import { useEffect, useRef, useState } from "react";
import type { Paginated, Trip } from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/FormField";

type TripWithOptionalRole = Trip;

interface TripPickerDialogProps {
  open: boolean;
  onCancel: () => void;
  onPick: (trip: Trip) => void;
}

export function TripPickerDialog({
  open,
  onCancel,
  onPick,
}: TripPickerDialogProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [trips, setTrips] = useState<TripWithOptionalRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Track which `open` transition we last handled so we can reset state from
  // the render body (React 19 "update state from props" pattern) rather than
  // synchronously inside an effect.
  const [lastLoadedOpen, setLastLoadedOpen] = useState<boolean>(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (open && !lastLoadedOpen) {
    setLastLoadedOpen(true);
    setStatus("loading");
    setError(null);
  }
  if (!open && lastLoadedOpen) {
    setLastLoadedOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<Paginated<TripWithOptionalRole>>(
          "/api/trips?limit=50",
          { method: "GET" },
        );
        if (cancelled) return;
        // Strict filter: only trips the caller can edit. If `role` is missing
        // (older API or unexpected payload), drop the trip — defensive default
        // keeps viewers from selecting a trip they cannot write to.
        const items = data.items.filter(
          (t) => t.role === "owner" || t.role === "editor",
        );
        setTrips(items);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load your trips. Please try again.";
        setError(message);
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Capture the previously focused element so we can restore on close.
    const previouslyFocused =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus to whatever was focused before opening the dialog.
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trip-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6"
      >
        <h2
          id="trip-picker-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Bookmark to which trip?
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Choose a trip you can edit.
        </p>

        <div className="mt-4">
          {status === "loading" && (
            <ul className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 animate-pulse"
                />
              ))}
            </ul>
          )}
          {status === "error" && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
            >
              {error}
            </p>
          )}
          {status === "ready" && trips.length === 0 && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              You don&apos;t have any trips you can edit. Ask a trip owner to
              invite you as editor.
            </p>
          )}
          {status === "ready" && trips.length > 0 && (
            <ul className="space-y-2">
              {trips.map((trip) => (
                <li key={trip.id}>
                  <button
                    type="button"
                    onClick={() => onPick(trip)}
                    className="w-full text-left rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
                    aria-label={`Bookmark to ${trip.name}`}
                  >
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">
                      {trip.name}
                    </span>
                    {trip.destination && (
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {trip.destination}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
        </div>

        {/* Hidden submit anchor preserved for parity with primary button class */}
        <span className={`sr-only ${primaryButtonClass}`} aria-hidden="true" />
      </div>
    </div>
  );
}
