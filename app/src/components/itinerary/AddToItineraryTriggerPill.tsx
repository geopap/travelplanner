"use client";

// B-033 — Client island for the "Add to Itinerary" pill rendered in the
// PlaceDetailView header pill row (sibling to "Open in Google Maps" + "Re-link").
// PlaceDetailView is a server component; this island hosts the open-state +
// dialog mount + on-demand fetch of the trip's days.

import { useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import type { TripDay } from "@/lib/types/domain";
import {
  AddToItineraryDialog,
  type AddToItineraryCategory,
} from "@/components/itinerary/AddToItineraryDialog";
import { SkeletonLine } from "@/components/Skeletons";

interface AddToItineraryTriggerPillProps {
  tripId: string;
  placeId: string;
  placeName: string;
  category: AddToItineraryCategory;
}

interface DaysResponse {
  items: TripDay[];
}

type DaysState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; days: TripDay[] }
  | { kind: "error"; message: string };

export function AddToItineraryTriggerPill({
  tripId,
  placeId,
  placeName,
  category,
}: AddToItineraryTriggerPillProps) {
  const [open, setOpen] = useState(false);
  const [daysState, setDaysState] = useState<DaysState>({ kind: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Lazy-load days only on first open — avoids a network call for every
  // place-detail page view.
  useEffect(() => {
    if (!open) return;
    if (daysState.kind !== "idle") return;
    let cancelled = false;
    setDaysState({ kind: "loading" });
    (async () => {
      try {
        const data = await apiFetch<DaysResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/days`,
        );
        if (cancelled) return;
        setDaysState({ kind: "ready", days: data.items ?? [] });
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiClientError
            ? err.status === 403
              ? "You don't have permission to add items to this trip."
              : "Failed to load trip days."
            : "Failed to load trip days.";
        setDaysState({ kind: "error", message: msg });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, daysState.kind, tripId]);

  // Toast auto-clears after 4s for accessibility / non-intrusive UX.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/60"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="add-to-itinerary-trigger"
      >
        Add to itinerary
      </button>
      {open && daysState.kind === "loading" && (
        <span role="status" aria-live="polite" className="inline-flex">
          <SkeletonLine className="h-4 w-24" />
          <span className="sr-only">Loading days…</span>
        </span>
      )}
      {open && daysState.kind === "error" && (
        <span role="alert" className="text-xs text-red-600">
          {daysState.message}
        </span>
      )}
      {daysState.kind === "ready" && (
        <AddToItineraryDialog
          open={open}
          onClose={() => setOpen(false)}
          tripId={tripId}
          placeId={placeId}
          placeName={placeName}
          category={category}
          days={daysState.days}
          onAdded={({ dayLabel }) => {
            setToast(`Added to ${dayLabel}`);
          }}
          returnFocusRef={triggerRef}
        />
      )}
      {toast && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          data-testid="add-to-itinerary-toast"
        >
          {toast}
        </span>
      )}
    </>
  );
}
