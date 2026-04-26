"use client";

// B-011 — Bookmark list rendered on the trip's Places tab. Receives the
// initial bookmarks list from its server-component parent, groups them by
// `BookmarkCategory` in the canonical order (restaurant, sight, museum,
// shopping, other), and sorts alphabetically by place name within each
// group. Owner/editor see edit & delete affordances; viewers see read-only.

import { useMemo, useState } from "react";
import type {
  Bookmark,
  BookmarkCategory,
  MemberRole,
} from "@/lib/types/domain";
import { useBookmarks } from "@/lib/hooks/useBookmarks";
import { BookmarkItem } from "./BookmarkItem";
import { BookmarkForm } from "./BookmarkForm";
import { BookmarkDeleteDialog } from "./BookmarkDeleteDialog";

interface BookmarkListProps {
  tripId: string;
  role: MemberRole;
  initialBookmarks: Bookmark[];
  /** Map of place_id → google_place_id, when known by the parent server page. */
  googlePlaceIdByPlaceId: Record<string, string | null>;
}

const GROUP_ORDER: readonly BookmarkCategory[] = [
  "restaurant",
  "sight",
  "museum",
  "shopping",
  "other",
] as const;

const GROUP_LABELS: Record<BookmarkCategory, string> = {
  restaurant: "Restaurants",
  sight: "Sights",
  museum: "Museums",
  shopping: "Shopping",
  other: "Other",
};

export function BookmarkList({
  tripId,
  role,
  initialBookmarks,
  googlePlaceIdByPlaceId,
}: BookmarkListProps) {
  const { bookmarks, loading, error, refetch } = useBookmarks(
    tripId,
    initialBookmarks,
  );

  const [editTarget, setEditTarget] = useState<Bookmark | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bookmark | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const buckets: Record<BookmarkCategory, Bookmark[]> = {
      restaurant: [],
      sight: [],
      museum: [],
      shopping: [],
      other: [],
    };
    for (const bm of bookmarks) {
      buckets[bm.category].push(bm);
    }
    for (const cat of GROUP_ORDER) {
      buckets[cat].sort((a, b) => {
        const an = a.place?.name ?? "";
        const bn = b.place?.name ?? "";
        return an.localeCompare(bn);
      });
    }
    return buckets;
  }, [bookmarks]);

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {statusMessage ?? ""}
      </p>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-4 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div
        className={`space-y-8 ${loading ? "opacity-60" : ""}`}
        aria-busy={loading}
      >
        {GROUP_ORDER.map((cat) => {
          const items = grouped[cat];
          if (items.length === 0) return null;
          return (
            <section
              key={cat}
              aria-labelledby={`bookmark-group-${cat}`}
              className="space-y-3"
            >
              <h2
                id={`bookmark-group-${cat}`}
                className="text-sm font-semibold uppercase tracking-wider text-zinc-500"
              >
                {GROUP_LABELS[cat]}{" "}
                <span className="text-zinc-400 font-normal">
                  ({items.length})
                </span>
              </h2>
              <ul className="space-y-3">
                {items.map((bm) => (
                  <BookmarkItem
                    key={bm.id}
                    bookmark={bm}
                    role={role}
                    googlePlaceId={googlePlaceIdByPlaceId[bm.place_id] ?? null}
                    onEdit={(b) => setEditTarget(b)}
                    onDelete={(b) => setDeleteTarget(b)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {editTarget && (
        <BookmarkForm
          mode="edit"
          tripId={tripId}
          bookmark={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async (saved) => {
            setEditTarget(null);
            setStatusMessage(`Updated bookmark for ${saved.place?.name ?? "place"}.`);
            await refetch();
          }}
        />
      )}

      <BookmarkDeleteDialog
        open={deleteTarget !== null}
        tripId={tripId}
        bookmark={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onDeleted={async (deleted) => {
          setDeleteTarget(null);
          setStatusMessage(
            `Removed bookmark for ${deleted.place?.name ?? "place"}.`,
          );
          await refetch();
        }}
      />
    </div>
  );
}
