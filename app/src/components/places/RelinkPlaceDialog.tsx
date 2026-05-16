"use client";

// B-026 — Re-link a bookmarked place (and any paired itinerary items) to a
// different Google place. Surfaced from the Place Detail header when the
// viewer is an owner/editor of the trip referenced via `?trip=` searchParam.
//
// The dialog pre-fills `PlaceSearchInput` with the current place name so a
// quick spelling/disambiguation tweak finds the correct candidate.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PlaceSearchInput } from "@/components/places/PlaceSearchInput";
import type { PlaceSearchResult } from "@/lib/hooks/usePlaceSearch";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/FormField";

interface RelinkPlaceDialogProps {
  open: boolean;
  onClose: () => void;
  tripId: string;
  fromPlaceId: string;
  currentPlaceName: string;
  /** Element to return focus to when the dialog closes (trigger pill). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

interface RelinkResponse {
  updated: { bookmarks: number; itinerary_items: number };
  new_place_id: string;
}

type Status = "idle" | "submitting" | "success" | "error";

export function RelinkPlaceDialog({
  open,
  onClose,
  tripId,
  fromPlaceId,
  currentPlaceName,
  returnFocusRef,
}: RelinkPlaceDialogProps) {
  const router = useRouter();
  const [picked, setPicked] = useState<PlaceSearchResult | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successCounts, setSuccessCounts] = useState<{
    bookmarks: number;
    items: number;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Track which `open` transition we last initialized so we can reset state
  // from the render body rather than synchronously inside an effect.
  const [openSeen, setOpenSeen] = useState(false);

  if (open && !openSeen) {
    setOpenSeen(true);
    setPicked(null);
    setStatus("idle");
    setErrorMessage(null);
  }
  if (!open && openSeen) {
    setOpenSeen(false);
  }

  useEffect(() => {
    if (!open) return;
    // Focus the Cancel button first so Esc/Tab behavior is predictable; the
    // search input gets focus via its own autoFocus prop.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Restore focus to the trigger pill when the dialog closes.
      const target = returnFocusRef?.current;
      if (target && typeof target.focus === "function") {
        target.focus();
      }
    };
  }, [open, onClose, returnFocusRef]);

  // Lightweight focus trap: keep Tab cycling inside the dialog.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  async function onConfirm() {
    if (!picked) return;
    setStatus("submitting");
    setErrorMessage(null);
    try {
      const data = await apiFetch<RelinkResponse>(
        `/api/trips/${encodeURIComponent(tripId)}/bookmarks/relink`,
        {
          method: "POST",
          body: {
            from_place_id: fromPlaceId,
            to_google_place_id: picked.google_place_id,
          },
        },
      );
      setSuccessCounts({
        bookmarks: data.updated.bookmarks,
        items: data.updated.itinerary_items,
      });
      setStatus("success");
      // Brief pause so the success message renders before navigation.
      const toGoogleId = picked.google_place_id;
      window.setTimeout(() => {
        router.replace(
          `/places/${encodeURIComponent(toGoogleId)}?trip=${encodeURIComponent(tripId)}`,
        );
        router.refresh();
        onClose();
      }, 600);
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiClientError) {
        if (err.status === 403) {
          setErrorMessage("You don't have permission to re-link in this trip.");
        } else if (err.status === 429) {
          setErrorMessage("Too many requests. Please try again shortly.");
        } else if (err.status === 400) {
          setErrorMessage("Invalid place selection. Please pick another.");
        } else if (err.status === 404) {
          setErrorMessage(
            "This place is no longer in the trip — refresh and try again.",
          );
        } else if (err.status === 502) {
          setErrorMessage("Google Places is unavailable. Try again shortly.");
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage("Re-link failed. Please try again.");
      }
    }
  }

  const canConfirm = picked !== null && status !== "submitting";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="relink-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6"
      >
        <h2
          id="relink-dialog-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Re-link to the correct place
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Search for the correct Google place. Your bookmark and any paired
          itinerary items will be updated.
        </p>

        <div className="mt-4">
          <PlaceSearchInput
            onSelect={(place) => {
              setPicked(place);
              setStatus("idle");
              setErrorMessage(null);
            }}
            placeholder="Search Google Places…"
            initialQuery={currentPlaceName}
            autoFocus
          />
        </div>

        {picked && status !== "success" && (
          <div
            className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 text-sm"
            aria-live="polite"
          >
            <span className="block text-[11px] uppercase tracking-wider text-zinc-500">
              Selected
            </span>
            <span className="block font-medium text-zinc-900 dark:text-zinc-50">
              {picked.name}
            </span>
            {picked.formatted_address && (
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                {picked.formatted_address}
              </span>
            )}
          </div>
        )}

        {status === "success" && successCounts && (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 p-3 text-sm text-emerald-700 dark:text-emerald-300"
          >
            Re-linked: {successCounts.bookmarks}{" "}
            {successCounts.bookmarks === 1 ? "bookmark" : "bookmarks"},{" "}
            {successCounts.items}{" "}
            {successCounts.items === 1 ? "itinerary item" : "itinerary items"}{" "}
            updated.
          </p>
        )}

        {status === "error" && errorMessage && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className={secondaryButtonClass}
            disabled={status === "submitting"}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={primaryButtonClass}
            disabled={!canConfirm}
            aria-disabled={!canConfirm}
          >
            {status === "submitting" ? "Re-linking…" : "Confirm re-link"}
          </button>
        </div>
      </div>
    </div>
  );
}
