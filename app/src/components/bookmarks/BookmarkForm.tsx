"use client";

// B-011 — Bookmark create/edit dialog form.
//
// Two modes:
//   - "create": POST /api/trips/[tripId]/bookmarks. Caller supplies tripId,
//               googlePlaceId, and the default narrowed category.
//   - "edit"  : PATCH /api/trips/[tripId]/bookmarks/[id]. Caller supplies the
//               existing bookmark.
//
// Error mapping per SOLUTION_DESIGN.md §B-011.3:
//   bookmark_exists   → "Already bookmarked in this trip for this category"
//   place_not_cached  → "Open the place once before bookmarking"
//   forbidden         → "You don't have permission"

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Bookmark, BookmarkCategory } from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { BOOKMARK_CATEGORIES } from "@/lib/bookmarks/categories";
import {
  FormField,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
  textareaClass,
} from "@/components/ui/FormField";

const NOTES_MAX = 500;

const CATEGORY_LABELS: Record<BookmarkCategory, string> = {
  restaurant: "Restaurant",
  sight: "Sight",
  museum: "Museum",
  shopping: "Shopping",
  other: "Other",
};

interface BaseProps {
  onClose: () => void;
  onSaved: (bookmark: Bookmark, mode: "create" | "edit") => void;
}

interface CreateProps extends BaseProps {
  mode: "create";
  tripId: string;
  googlePlaceId: string;
  defaultCategory: BookmarkCategory;
}

interface EditProps extends BaseProps {
  mode: "edit";
  tripId: string;
  bookmark: Bookmark;
}

export type BookmarkFormProps = CreateProps | EditProps;

function mapErrorCode(code: string, fallback: string): string {
  switch (code) {
    case "bookmark_exists":
      return "Already bookmarked in this trip for this category.";
    case "place_not_cached":
      return "Open the place once before bookmarking.";
    case "forbidden":
      return "You don't have permission.";
    case "rate_limit_exceeded":
      return "Too many bookmark changes — please wait a moment.";
    default:
      return fallback;
  }
}

export function BookmarkForm(props: BookmarkFormProps) {
  const initialCategory: BookmarkCategory =
    props.mode === "create" ? props.defaultCategory : props.bookmark.category;
  const initialNotes =
    props.mode === "create" ? "" : (props.bookmark.notes ?? "");

  const [category, setCategory] = useState<BookmarkCategory>(initialCategory);
  const [notes, setNotes] = useState<string>(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) props.onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, submitting]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (notes.length > NOTES_MAX) {
      setFormError(`Notes must be ${NOTES_MAX} characters or fewer.`);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (props.mode === "create") {
        const body = {
          google_place_id: props.googlePlaceId,
          category,
          notes: notes.trim() ? notes.trim() : undefined,
        };
        const res = await apiFetch<{ bookmark: Bookmark }>(
          `/api/trips/${encodeURIComponent(props.tripId)}/bookmarks`,
          { method: "POST", body },
        );
        props.onSaved(res.bookmark, "create");
      } else {
        const body: Record<string, unknown> = {
          category,
          notes: notes.trim() ? notes.trim() : null,
        };
        const res = await apiFetch<{ bookmark: Bookmark }>(
          `/api/trips/${encodeURIComponent(props.tripId)}/bookmarks/${encodeURIComponent(props.bookmark.id)}`,
          { method: "PATCH", body },
        );
        props.onSaved(res.bookmark, "edit");
      }
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? mapErrorCode(err.code, err.message)
          : "Could not save the bookmark. Please try again.";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const titleId = "bookmark-form-title";
  const remaining = NOTES_MAX - notes.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
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
              {props.mode === "create" ? "Add bookmark" : "Edit bookmark"}
            </h2>
            <button
              type="button"
              onClick={props.onClose}
              disabled={submitting}
              className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 text-xl leading-none -mt-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {formError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
            >
              {formError}
            </div>
          )}

          <div className="mt-5 space-y-4">
            <FormField id="bookmark-category" label="Category" required>
              <select
                ref={firstFieldRef}
                id="bookmark-category"
                value={category}
                onChange={(e) => {
                  const next = e.target.value;
                  // Runtime-narrow against the canonical list — never trust
                  // raw <option> values; defensive against future option list
                  // edits.
                  const match = BOOKMARK_CATEGORIES.find((c) => c === next);
                  if (match) setCategory(match);
                }}
                className={selectClass}
                disabled={submitting}
              >
                {BOOKMARK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField
              id="bookmark-notes"
              label="Notes"
              hint={`${remaining} characters remaining`}
            >
              <textarea
                id="bookmark-notes"
                rows={4}
                maxLength={NOTES_MAX}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={textareaClass}
                placeholder="Why this place? Reservation tips, what to order, etc."
                aria-describedby="bookmark-notes-counter"
                disabled={submitting}
              />
            </FormField>
            <p
              id="bookmark-notes-counter"
              className="sr-only"
              aria-live="polite"
            >
              {remaining} characters remaining
            </p>
          </div>

          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={props.onClose}
              disabled={submitting}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={primaryButtonClass}
            >
              {submitting
                ? "Saving…"
                : props.mode === "create"
                  ? "Add bookmark"
                  : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
