"use client";

// B-037 — "Add a place" dialog launched from the trip Places list header.
//
// Reuses `PlaceSearchInput` (B-015) for the Google Places combobox and the
// canonical `POST /api/trips/[id]/bookmarks` route (no parallel endpoint).
// Before POSTing we GET `/api/places/[googlePlaceId]` to hydrate the place
// cache so the bookmark insert never trips the `place_not_cached` path.
//
// 409 `bookmark_exists` is surfaced inline; the dialog stays open so the user
// can pick a different place or category without losing state.
//
// Z-index `z-[1100]` matches `RelinkPlaceDialog` so the modal stays above any
// Leaflet stacking context on the trip detail map.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { PlaceSearchInput } from "@/components/places/PlaceSearchInput";
import type { PlaceSearchResult } from "@/lib/hooks/usePlaceSearch";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import {
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
  textareaClass,
} from "@/components/ui/FormField";
import { BOOKMARK_CATEGORIES } from "@/lib/bookmarks/categories";
import type { Bookmark, BookmarkCategory } from "@/lib/types/domain";

const NOTES_MAX = 500;

const CATEGORY_LABELS: Record<BookmarkCategory, string> = {
  restaurant: "Restaurant",
  sight: "Sight",
  museum: "Museum",
  shopping: "Shopping",
  other: "Other",
};

interface AddPlaceDialogProps {
  open: boolean;
  onClose: () => void;
  tripId: string;
  /** Pre-selects the category dropdown (e.g. active tab on Places page). */
  defaultCategory?: BookmarkCategory;
  onAdded: (bookmark: Bookmark) => void;
  /** Element to return focus to when the dialog closes. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

type Status = "idle" | "submitting" | "error";

function mapErrorCode(code: string, fallback: string): string {
  switch (code) {
    case "bookmark_exists":
      return "Already bookmarked in this trip for this category.";
    case "place_not_cached":
      return "Couldn't load that place from Google. Try another result.";
    case "forbidden":
      return "You don't have permission to add places to this trip.";
    case "rate_limit_exceeded":
      return "Too many bookmark changes — please wait a moment.";
    case "places_unavailable":
      return "Google Places is unavailable. Try again shortly.";
    default:
      return fallback;
  }
}

export function AddPlaceDialog({
  open,
  onClose,
  tripId,
  defaultCategory,
  onAdded,
  returnFocusRef,
}: AddPlaceDialogProps) {
  const initialCategory: BookmarkCategory = defaultCategory ?? "restaurant";

  const [picked, setPicked] = useState<PlaceSearchResult | null>(null);
  const [category, setCategory] = useState<BookmarkCategory>(initialCategory);
  const [notes, setNotes] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Reset state on each open transition (mirrors RelinkPlaceDialog pattern).
  const [openSeen, setOpenSeen] = useState(false);
  if (open && !openSeen) {
    setOpenSeen(true);
    setPicked(null);
    setCategory(initialCategory);
    setNotes("");
    setStatus("idle");
    setErrorMessage(null);
  }
  if (!open && openSeen) {
    setOpenSeen(false);
  }

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && status !== "submitting") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const target = returnFocusRef?.current;
      if (target && typeof target.focus === "function") target.focus();
    };
  }, [open, onClose, returnFocusRef, status]);

  // Lightweight focus trap.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!picked) {
        setErrorMessage("Pick a place to add.");
        setStatus("error");
        return;
      }
      if (notes.length > NOTES_MAX) {
        setErrorMessage(`Notes must be ${NOTES_MAX} characters or fewer.`);
        setStatus("error");
        return;
      }
      setStatus("submitting");
      setErrorMessage(null);

      try {
        // Pre-hydrate the places cache so the bookmark insert always finds a
        // cached row. GET /api/places/[googlePlaceId] upserts on cache miss.
        try {
          await apiFetch<unknown>(
            `/api/places/${encodeURIComponent(picked.google_place_id)}`,
            { method: "GET" },
          );
        } catch {
          // Non-fatal: bookmark POST still maps `place_not_cached` to a clear
          // error message below. Swallowing keeps the happy-path tight.
        }

        const body = {
          google_place_id: picked.google_place_id,
          category,
          notes: notes.trim() ? notes.trim() : undefined,
        };
        const res = await apiFetch<{ bookmark: Bookmark }>(
          `/api/trips/${encodeURIComponent(tripId)}/bookmarks`,
          { method: "POST", body },
        );
        onAdded(res.bookmark);
      } catch (err) {
        setStatus("error");
        if (err instanceof ApiClientError) {
          setErrorMessage(mapErrorCode(err.code, err.message));
        } else {
          setErrorMessage("Could not add the place. Please try again.");
        }
      }
    },
    [picked, notes, category, tripId, onAdded],
  );

  if (!open) return null;

  const canSubmit = picked !== null && status !== "submitting";
  const remaining = NOTES_MAX - notes.length;
  const titleId = "add-place-dialog-title";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
    >
      <div
        ref={dialogRef}
        className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl"
      >
        <form onSubmit={onSubmit} noValidate className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Add a place
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={status === "submitting"}
              className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 text-xl leading-none -mt-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Search Google for a place, pick a category, and add it to this
            trip&apos;s Places list.
          </p>

          {status === "error" && errorMessage && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
            >
              {errorMessage}
            </div>
          )}

          <div className="mt-5 space-y-4">
            <div>
              <label
                className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-1.5"
                htmlFor="add-place-search"
              >
                Place
                <span className="text-red-600 ml-0.5">*</span>
              </label>
              <PlaceSearchInput
                onSelect={(place) => {
                  setPicked(place);
                  if (status === "error") {
                    setStatus("idle");
                    setErrorMessage(null);
                  }
                }}
                placeholder="Search Google Places…"
                autoFocus
              />
            </div>

            {picked && (
              <div
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-3 text-sm"
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

            <FormField id="add-place-category" label="Category" required>
              <select
                id="add-place-category"
                value={category}
                onChange={(e) => {
                  const next = e.target.value;
                  const match = BOOKMARK_CATEGORIES.find((c) => c === next);
                  if (match) setCategory(match);
                }}
                className={selectClass}
                disabled={status === "submitting"}
              >
                {BOOKMARK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              id="add-place-notes"
              label="Notes"
              hint={`${remaining} characters remaining`}
            >
              <textarea
                id="add-place-notes"
                rows={3}
                maxLength={NOTES_MAX}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={textareaClass}
                placeholder="Optional — why this place, what to order, etc."
                disabled={status === "submitting"}
              />
            </FormField>
          </div>

          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onClose}
              disabled={status === "submitting"}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
              className={primaryButtonClass}
            >
              {status === "submitting" ? "Adding…" : "Add place"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
