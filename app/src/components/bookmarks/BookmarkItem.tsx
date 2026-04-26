"use client";

// B-011 — Single bookmark row inside `BookmarkList`. Shows the place name
// (linked to its detail page via google_place_id when available, else the
// internal place_id), a truncated address, the bookmark category badge, and
// optional notes. Edit/delete buttons render only when the viewer's role
// permits writes (owner|editor).

import Link from "next/link";
import type { Bookmark, BookmarkCategory, MemberRole } from "@/lib/types/domain";

interface BookmarkItemProps {
  bookmark: Bookmark;
  role: MemberRole;
  /** google_place_id resolved by the page when available — falls back to place_id. */
  googlePlaceId?: string | null;
  onEdit: (bookmark: Bookmark) => void;
  onDelete: (bookmark: Bookmark) => void;
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

export function BookmarkItem({
  bookmark,
  role,
  googlePlaceId,
  onEdit,
  onDelete,
}: BookmarkItemProps) {
  const canWrite = role !== "viewer";
  const placeName = bookmark.place?.name ?? "Untitled place";
  const address = bookmark.place?.formatted_address ?? null;
  const href = googlePlaceId
    ? `/places/${encodeURIComponent(googlePlaceId)}`
    : `/places/${encodeURIComponent(bookmark.place_id)}`;

  return (
    <li
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5"
      aria-label={`Bookmark: ${placeName}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${CATEGORY_COLORS[bookmark.category]}`}
              aria-label={`Category: ${CATEGORY_LABELS[bookmark.category]}`}
            >
              {CATEGORY_LABELS[bookmark.category]}
            </span>
          </div>
          <h3 className="mt-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
            <Link
              href={href}
              className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 rounded"
            >
              {placeName}
            </Link>
          </h3>
          {address && (
            <p
              className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 truncate"
              title={address}
            >
              {address}
            </p>
          )}
          {bookmark.notes && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
              {bookmark.notes}
            </p>
          )}
        </div>
        {canWrite && (
          <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onEdit(bookmark)}
              className="h-8 px-3 rounded-full border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
              aria-label={`Edit bookmark for ${placeName}`}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(bookmark)}
              className="h-8 px-3 rounded-full border border-red-300 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label={`Delete bookmark for ${placeName}`}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
