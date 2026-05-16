"use client";

// B-011 — Bookmark list rendered on the trip's Places tab. Receives the
// initial bookmarks list from its server-component parent, groups them by
// `BookmarkCategory` in the canonical order (restaurant, sight, museum,
// shopping, other), and sorts alphabetically by place name within each
// group. Owner/editor see edit & delete affordances; viewers see read-only.
//
// B-028 — Categories are presented as a horizontal ARIA Tabs widget. Only the
// active category's panel is rendered; the active tab is mirrored to the URL
// via `?cat=<category>` (replace, no history push) so deep-links work and
// page refresh restores the tab. 0-count tabs render as visually-disabled
// buttons that switch to a per-category empty state when clicked.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
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

const CAT_QUERY_KEY = "cat";

function isBookmarkCategory(value: string | null): value is BookmarkCategory {
  return (
    value !== null &&
    (GROUP_ORDER as readonly string[]).includes(value)
  );
}

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

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<BookmarkCategory, HTMLButtonElement | null>>({
    restaurant: null,
    sight: null,
    museum: null,
    shopping: null,
    other: null,
  });

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

  const totalCount = bookmarks.length;

  // Default active = first category in GROUP_ORDER with count > 0.
  const defaultActive: BookmarkCategory = useMemo(() => {
    for (const cat of GROUP_ORDER) {
      if (grouped[cat].length > 0) return cat;
    }
    return GROUP_ORDER[0];
  }, [grouped]);

  const urlCat = searchParams.get(CAT_QUERY_KEY);
  // If URL has a valid category, honor it (even 0-count → shows empty state).
  // Otherwise fall back to first non-empty category.
  const activeCat: BookmarkCategory = isBookmarkCategory(urlCat)
    ? urlCat
    : defaultActive;

  const setActiveCat = useCallback(
    (cat: BookmarkCategory) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(CAT_QUERY_KEY, cat);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Auto-scroll active tab into view on mobile horizontal scroller.
  useEffect(() => {
    const btn = tabRefs.current[activeCat];
    if (btn && typeof btn.scrollIntoView === "function") {
      btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeCat]);

  const onTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const currentIdx = GROUP_ORDER.indexOf(activeCat);
      if (currentIdx < 0) return;
      let nextIdx: number | null = null;
      switch (event.key) {
        case "ArrowRight":
          nextIdx = (currentIdx + 1) % GROUP_ORDER.length;
          break;
        case "ArrowLeft":
          nextIdx =
            (currentIdx - 1 + GROUP_ORDER.length) % GROUP_ORDER.length;
          break;
        case "Home":
          nextIdx = 0;
          break;
        case "End":
          nextIdx = GROUP_ORDER.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const nextCat = GROUP_ORDER[nextIdx];
      setActiveCat(nextCat);
      // Move focus to the newly active tab (roving tabindex).
      const nextBtn = tabRefs.current[nextCat];
      if (nextBtn) nextBtn.focus();
    },
    [activeCat, setActiveCat],
  );

  // Zero bookmarks total → existing empty state, no tabs.
  if (totalCount === 0 && !loading && !error) {
    return (
      <div>
        <p className="sr-only" aria-live="polite">
          {statusMessage ?? ""}
        </p>
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No bookmarks yet.
          </p>
        </div>
      </div>
    );
  }

  const activeItems = grouped[activeCat];
  const panelId = `bookmark-tabpanel-${activeCat}`;

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
        ref={tabListRef}
        role="tablist"
        aria-label="Bookmark categories"
        className="mb-4 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-zinc-200 dark:border-zinc-800 -mx-1 px-1 sm:mx-0 sm:px-0"
      >
        {GROUP_ORDER.map((cat) => {
          const count = grouped[cat].length;
          const isActive = cat === activeCat;
          const isEmpty = count === 0;
          const tabId = `bookmark-tab-${cat}`;
          const controlsId = `bookmark-tabpanel-${cat}`;
          return (
            <button
              key={cat}
              ref={(el) => {
                tabRefs.current[cat] = el;
              }}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={controlsId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveCat(cat)}
              onKeyDown={onTabKeyDown}
              className={[
                "min-h-[44px] px-4 py-2 text-sm font-medium",
                "border-b-2 -mb-px transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950 rounded-t",
                isActive
                  ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300"
                  : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100",
                isEmpty && !isActive ? "opacity-40" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {GROUP_LABELS[cat]}{" "}
              <span className="font-normal text-zinc-500 dark:text-zinc-400">
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={loading ? "opacity-60" : ""}
        aria-busy={loading}
      >
        <section
          key={activeCat}
          id={panelId}
          role="tabpanel"
          aria-labelledby={`bookmark-tab-${activeCat}`}
          tabIndex={0}
          className="space-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          {activeItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No {GROUP_LABELS[activeCat].toLowerCase()} bookmarked yet.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {activeItems.map((bm) => (
                <BookmarkItem
                  key={bm.id}
                  bookmark={bm}
                  role={role}
                  googlePlaceId={
                    bm.place_id
                      ? googlePlaceIdByPlaceId[bm.place_id] ?? null
                      : null
                  }
                  onEdit={(b) => setEditTarget(b)}
                  onDelete={(b) => setDeleteTarget(b)}
                />
              ))}
            </ul>
          )}
        </section>
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
