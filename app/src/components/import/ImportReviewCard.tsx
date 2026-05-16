"use client";

// B-021 — One review card per LLM-extracted place.
//
// User confirms:
//   • Whether to save this place at all ("Save this" toggle, default ON).
//   • Which bookmark category to use (pre-filled from LLM → narrowed).
//   • Which Google Place the LLM-suggested name actually refers to
//     (Places autocomplete is mandatory before save — matches the backend
//     contract that every saved entry must carry a google_place_id).
//
// The autocomplete is the reused B-009 component (`PlaceSearchInput`); we
// do NOT roll a second one.

import { useId } from "react";

import { PlaceSearchInput } from "@/components/places/PlaceSearchInput";
import {
  FormField,
  selectClass,
} from "@/components/ui/FormField";
import { BOOKMARK_CATEGORIES } from "@/lib/bookmarks/categories";
import type { BookmarkCategory } from "@/lib/types/domain";
import type { PlaceSearchResult } from "@/lib/hooks/usePlaceSearch";

export interface ReviewPlace {
  /** Stable client-side index — used as React key, never sent to backend. */
  uid: string;
  name: string;
  why: string;
  category: BookmarkCategory;
  save: boolean;
  /** Set once the user picks a hit in the autocomplete. */
  googlePlaceId: string | null;
  /** Display label for the resolved Google place — empty until selected. */
  resolvedName: string;
}

interface ImportReviewCardProps {
  place: ReviewPlace;
  index: number;
  onChange: (next: ReviewPlace) => void;
  /** True when the user has tried to submit without picking a Google place. */
  showAutocompleteError: boolean;
}

const CATEGORY_LABEL: Record<BookmarkCategory, string> = {
  restaurant: "Restaurant",
  sight: "Sight",
  museum: "Museum",
  shopping: "Shopping",
  other: "Other",
};

export function ImportReviewCard({
  place,
  index,
  onChange,
  showAutocompleteError,
}: ImportReviewCardProps): React.JSX.Element {
  const saveId = useId();
  const categoryId = useId();
  const autocompleteLabelId = useId();
  const errorId = useId();

  const needsAutocomplete = place.save && place.googlePlaceId === null;
  const showError = needsAutocomplete && showAutocompleteError;

  function handleSelect(p: PlaceSearchResult): void {
    onChange({
      ...place,
      googlePlaceId: p.google_place_id,
      resolvedName: p.name,
    });
  }

  return (
    <article
      className={`rounded-2xl border p-4 sm:p-5 bg-white dark:bg-zinc-900 ${
        place.save
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-dashed border-zinc-300 dark:border-zinc-700 opacity-70"
      }`}
      aria-labelledby={`${saveId}-name`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Place {index + 1}
          </p>
          <h3
            id={`${saveId}-name`}
            className="mt-0.5 text-base font-semibold text-zinc-900 dark:text-zinc-50 truncate"
          >
            {place.name}
          </h3>
          {place.why && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {place.why}
            </p>
          )}
        </div>
        <label
          htmlFor={saveId}
          className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer select-none"
        >
          <input
            id={saveId}
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
            checked={place.save}
            onChange={(e) => onChange({ ...place, save: e.target.checked })}
          />
          Save this
        </label>
      </header>

      {place.save && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField id={categoryId} label="Category">
            <select
              id={categoryId}
              className={selectClass}
              value={place.category}
              onChange={(e) =>
                onChange({
                  ...place,
                  category: e.target.value as BookmarkCategory,
                })
              }
            >
              {BOOKMARK_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </FormField>

          <div>
            <div
              id={autocompleteLabelId}
              className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-1.5"
            >
              Google place <span className="text-red-600 ml-0.5">*</span>
            </div>
            <PlaceSearchInput
              onSelect={handleSelect}
              placeholder="Search Google for the real place…"
              initialQuery={place.resolvedName || place.name}
            />
            {place.googlePlaceId && (
              <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                Matched to {place.resolvedName}.
              </p>
            )}
            {showError ? (
              <p
                id={errorId}
                role="alert"
                className="mt-1.5 text-xs text-red-600 dark:text-red-400"
              >
                Pick the matching Google place before saving, or untick &ldquo;Save this&rdquo;.
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-zinc-500">
                Required — we save the Google-confirmed place, not the raw name.
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
