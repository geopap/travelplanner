"use client";

// B-011 — "Bookmark" CTA on a place detail page.
//
// Flow:
//   1. Click → open `TripPickerDialog`.
//   2. User picks a trip → close picker, open `BookmarkForm` in create mode
//      pre-filled with the narrowed category.
//   3. Successful create → close form, show a transient confirmation message
//      with the trip name (aria-live polite).
//
// Only mounted when the user is authenticated (parent server component
// gates this).

import { useState } from "react";
import type { Trip } from "@/lib/types/domain";
import type { PlaceCategory } from "@/lib/google/categories";
import { narrowCategoryForBookmark } from "@/lib/bookmarks/categories";
import { TripPickerDialog } from "./TripPickerDialog";
import { BookmarkForm } from "@/components/bookmarks/BookmarkForm";

interface BookmarkButtonProps {
  googlePlaceId: string;
  placeCategory: PlaceCategory;
  placeName: string;
}

export function BookmarkButton({
  googlePlaceId,
  placeCategory,
  placeName,
}: BookmarkButtonProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedTrip, setPickedTrip] = useState<Trip | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const defaultCategory = narrowCategoryForBookmark(placeCategory);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="inline-flex items-center justify-center rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        aria-label={`Bookmark ${placeName}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="w-4 h-4 mr-2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"
          />
        </svg>
        Bookmark
      </button>

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast ?? ""}
      </p>
      {toast && (
        <p
          className="mt-2 text-sm text-emerald-700 dark:text-emerald-300"
          aria-hidden="true"
        >
          {toast}
        </p>
      )}

      <TripPickerDialog
        open={pickerOpen && pickedTrip === null}
        onCancel={() => setPickerOpen(false)}
        onPick={(trip) => {
          setPickedTrip(trip);
          setPickerOpen(false);
        }}
      />

      {pickedTrip && (
        <BookmarkForm
          mode="create"
          tripId={pickedTrip.id}
          googlePlaceId={googlePlaceId}
          defaultCategory={defaultCategory}
          onClose={() => setPickedTrip(null)}
          onSaved={() => {
            const tripName = pickedTrip.name;
            setPickedTrip(null);
            setToast(`Bookmarked to ${tripName}`);
            // Auto-clear after a few seconds for cleanliness.
            window.setTimeout(() => setToast(null), 4000);
          }}
        />
      )}
    </div>
  );
}
