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
import { AddPlaceDialog } from "@/components/places/AddPlaceDialog";
import { AddToItineraryDialog } from "@/components/itinerary/AddToItineraryDialog";
import { primaryButtonClass } from "@/components/ui/FormField";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import type { TripDay } from "@/lib/types/domain";

interface PlanSplitCounts {
  all: number;
  planned: number;
  notPlanned: number;
}

type PlanFilter = "all" | "planned" | "notplanned";

const PLAN_QUERY_KEY = "plan";
const PLAN_OPTIONS: readonly PlanFilter[] = ["all", "planned", "notplanned"] as const;

function isPlanFilter(v: string | null): v is PlanFilter {
  return v !== null && (PLAN_OPTIONS as readonly string[]).includes(v);
}

const PLAN_LABELS: Record<PlanFilter, string> = {
  all: "All",
  planned: "Planned",
  notplanned: "Not Planned",
};

interface BookmarkListProps {
  tripId: string;
  role: MemberRole;
  initialBookmarks: Bookmark[];
  /** Map of place_id → google_place_id, when known by the parent server page. */
  googlePlaceIdByPlaceId: Record<string, string | null>;
  /** B-038 — per-bookmark `planned` flag from the canonical pairing rule. */
  plannedByBookmarkId?: Record<string, boolean>;
  /** B-038 — trip-wide split counts used as segmented-control labels. */
  planSplitCounts?: PlanSplitCounts;
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
  plannedByBookmarkId,
  planSplitCounts,
}: BookmarkListProps) {
  const { bookmarks, loading, error, refetch } = useBookmarks(
    tripId,
    initialBookmarks,
  );

  const [editTarget, setEditTarget] = useState<Bookmark | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bookmark | null>(null);
  const [addToItineraryTarget, setAddToItineraryTarget] =
    useState<Bookmark | null>(null);
  // B-033 — Days are fetched once on first "Add to itinerary" click and reused.
  const [tripDays, setTripDays] = useState<TripDay[] | null>(null);
  const [daysLoading, setDaysLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // B-037 — Add-a-place dialog state. Editor/owner only; the button is
  // hidden from viewers (server-side route also rejects them with 403).
  const [addOpen, setAddOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const canWrite = role === "owner" || role === "editor";

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

  // B-038 — active plan filter from `?plan=`; invalid values fall back to all.
  const urlPlanRaw = searchParams.get(PLAN_QUERY_KEY);
  const activePlan: PlanFilter = isPlanFilter(urlPlanRaw) ? urlPlanRaw : "all";

  // Filtered bookmark set used for category grouping + tab counts. The
  // trip-wide segmented-control counts (AC 6) come from `planSplitCounts`
  // and are unaffected by this filter.
  const filteredBookmarks = useMemo(() => {
    if (activePlan === "all") return bookmarks;
    const map = plannedByBookmarkId;
    if (!map) return bookmarks;
    const wantPlanned = activePlan === "planned";
    return bookmarks.filter((b) => Boolean(map[b.id]) === wantPlanned);
  }, [bookmarks, activePlan, plannedByBookmarkId]);

  const grouped = useMemo(() => {
    const buckets: Record<BookmarkCategory, Bookmark[]> = {
      restaurant: [],
      sight: [],
      museum: [],
      shopping: [],
      other: [],
    };
    for (const bm of filteredBookmarks) {
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
  }, [filteredBookmarks]);

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

  // B-038 — Switch the `?plan=` filter. Default value (`all`) is omitted from
  // the URL to keep clean defaults (mirrors B-028's `?cat=` convention).
  const setActivePlan = useCallback(
    (plan: PlanFilter) => {
      const params = new URLSearchParams(searchParams.toString());
      if (plan === "all") {
        params.delete(PLAN_QUERY_KEY);
      } else {
        params.set(PLAN_QUERY_KEY, plan);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // B-038 — Roving-tabindex refs for the segmented radio group.
  const planRefs = useRef<Record<PlanFilter, HTMLButtonElement | null>>({
    all: null,
    planned: null,
    notplanned: null,
  });

  const onPlanKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      const currentIdx = PLAN_OPTIONS.indexOf(activePlan);
      if (currentIdx < 0) return;
      let nextIdx: number | null = null;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIdx = (currentIdx + 1) % PLAN_OPTIONS.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIdx =
            (currentIdx - 1 + PLAN_OPTIONS.length) % PLAN_OPTIONS.length;
          break;
        case "Home":
          nextIdx = 0;
          break;
        case "End":
          nextIdx = PLAN_OPTIONS.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const next = PLAN_OPTIONS[nextIdx];
      setActivePlan(next);
      const btn = planRefs.current[next];
      if (btn) btn.focus();
    },
    [activePlan, setActivePlan],
  );

  // Resolved counts shown in the segmented-control labels — trip-wide and
  // independent of `?cat=` or the active plan filter (AC 6). Falls back to a
  // local total when the parent didn't pass counts (e.g. legacy callers).
  const splitCounts: PlanSplitCounts = planSplitCounts ?? {
    all: bookmarks.length,
    planned: 0,
    notPlanned: bookmarks.length,
  };

  // B-033 — Open the Add-to-Itinerary dialog for a bookmark. Lazy-loads
  // trip_days on first click; subsequent clicks reuse the cached list.
  const openAddToItinerary = useCallback(
    async (bm: Bookmark) => {
      if (tripDays !== null) {
        setAddToItineraryTarget(bm);
        return;
      }
      setDaysLoading(true);
      try {
        const data = await apiFetch<{ items: TripDay[] }>(
          `/api/trips/${encodeURIComponent(tripId)}/days`,
        );
        setTripDays(data.items ?? []);
        setAddToItineraryTarget(bm);
      } catch (err) {
        const msg =
          err instanceof ApiClientError && err.status === 403
            ? "You don't have permission to add items to this trip."
            : "Couldn't load trip days. Please try again.";
        setStatusMessage(msg);
      } finally {
        setDaysLoading(false);
      }
    },
    [tripDays, tripId],
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

  // Zero bookmarks total → empty state with an inline "Add a place" CTA for
  // editors/owners (B-037). Viewers see the original read-only message.
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
          {canWrite && (
            <div className="mt-4 flex justify-center">
              <button
                ref={addButtonRef}
                type="button"
                onClick={() => setAddOpen(true)}
                className={primaryButtonClass}
              >
                Add a place
              </button>
            </div>
          )}
        </div>
        {canWrite && (
          <AddPlaceDialog
            open={addOpen}
            onClose={() => setAddOpen(false)}
            tripId={tripId}
            onAdded={async (added) => {
              setAddOpen(false);
              setStatusMessage(
                `Added ${added.place?.name ?? "place"} to your places.`,
              );
              await refetch();
            }}
            returnFocusRef={addButtonRef}
          />
        )}
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

      {canWrite && (
        <div className="mb-3 flex justify-end">
          <button
            ref={addButtonRef}
            type="button"
            onClick={() => setAddOpen(true)}
            className={primaryButtonClass}
          >
            Add a place
          </button>
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

      {/* B-038 — All / Planned / Not Planned segmented control. Placed BELOW
          the tablist (per B-037 coordination) and ABOVE the active panel.
          Trip-wide split counts; full-width on mobile, inline on sm+. */}
      <div
        role="radiogroup"
        aria-label="Filter by planned status"
        className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800 sm:inline-grid sm:w-auto"
      >
        {PLAN_OPTIONS.map((opt) => {
          const isActive = opt === activePlan;
          const count =
            opt === "all"
              ? splitCounts.all
              : opt === "planned"
                ? splitCounts.planned
                : splitCounts.notPlanned;
          return (
            <button
              key={opt}
              ref={(el) => {
                planRefs.current[opt] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActivePlan(opt)}
              onKeyDown={onPlanKeyDown}
              data-testid={`plan-filter-${opt}`}
              className={[
                "min-h-[44px] rounded-md px-3 sm:px-4 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950",
                isActive
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100",
              ].join(" ")}
            >
              {PLAN_LABELS[opt]}{" "}
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
                {activePlan === "all"
                  ? `No ${GROUP_LABELS[activeCat].toLowerCase()} bookmarked yet.`
                  : `No ${GROUP_LABELS[activeCat].toLowerCase()} are ${activePlan === "planned" ? "planned" : "not planned"} yet.`}
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
                  tripId={tripId}
                  onEdit={(b) => setEditTarget(b)}
                  onDelete={(b) => setDeleteTarget(b)}
                  onAddToItinerary={
                    canWrite
                      ? (b) => {
                          void openAddToItinerary(b);
                        }
                      : undefined
                  }
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

      {canWrite && addToItineraryTarget && tripDays && (
        <AddToItineraryDialog
          open={addToItineraryTarget !== null}
          onClose={() => setAddToItineraryTarget(null)}
          tripId={tripId}
          placeId={addToItineraryTarget.place_id ?? ""}
          placeName={
            addToItineraryTarget.place?.name ??
            addToItineraryTarget.notes?.split(" — ")[0]?.trim() ??
            "Untitled place"
          }
          category={addToItineraryTarget.category}
          days={tripDays}
          onAdded={({ dayLabel }) => {
            setStatusMessage(`Added to ${dayLabel}.`);
            setAddToItineraryTarget(null);
          }}
        />
      )}
      {daysLoading && (
        <span className="sr-only" role="status" aria-live="polite">
          Loading trip days…
        </span>
      )}

      {canWrite && (
        <AddPlaceDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          tripId={tripId}
          defaultCategory={activeCat}
          onAdded={async (added) => {
            setAddOpen(false);
            // Switch to the added bookmark's category so the new row is in view.
            if (added.category !== activeCat) {
              setActiveCat(added.category);
            }
            setStatusMessage(
              `Added ${added.place?.name ?? "place"} to your places.`,
            );
            await refetch();
          }}
          returnFocusRef={addButtonRef}
        />
      )}
    </div>
  );
}
