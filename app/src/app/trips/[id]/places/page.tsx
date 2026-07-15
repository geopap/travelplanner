// B-011 — Places (Bookmarks) tab for a trip.
// B-038 — Adds the `planned: boolean` flag per bookmark (via the shared
// trip-scoped helper) plus trip-wide All/Planned/NotPlanned split counts.
//
// Server component:
//   1. Verifies the current user has at least viewer access to the trip
//      (defense-in-depth on top of RLS).
//   2. Loads up to 500 bookmarks for the trip with the joined slim place row
//      AND a `planned` flag derived via the shared B-031/B-038 pairing rule.
//   3. Resolves google_place_id per bookmark via a single batched query
//      against `places` (avoids N+1).
//   4. Computes trip-wide split counts (all / planned / not planned) once.
//   5. Hands off to the client `BookmarkList`, gated by the viewer's role.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkTripAccess } from "@/lib/trip-access";
import { BookmarkList } from "@/components/bookmarks/BookmarkList";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { getBookmarksWithPlannedFlag } from "@/lib/bookmarks/pairing";

export const metadata = { title: "Places · TravelPlanner" };
export const dynamic = "force-dynamic";

const LIMIT = 500;

const PlaceIdRowSchema = z.object({
  id: z.string().uuid(),
  google_place_id: z.string().nullable(),
});

export default async function TripPlacesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: tripId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(`/sign-in?redirect=/trips/${encodeURIComponent(tripId)}/places`);
  }

  const access = await checkTripAccess(supabase, tripId, auth.user.id, "viewer");
  if (!access.ok) {
    notFound();
  }
  const role = access.role;

  // B-038 — Trip-scoped fetch via the shared pairing helper. Two indexed
  // round-trips (itinerary keys + bookmarks) + in-memory `isPaired`. Single
  // source of truth for the OR predicate — never inline it here.
  let bookmarksWithFlag: Awaited<
    ReturnType<typeof getBookmarksWithPlannedFlag>
  >;
  try {
    bookmarksWithFlag = await getBookmarksWithPlannedFlag(supabase, {
      tripId,
      limit: LIMIT,
    });
  } catch {
    throw new Error("bookmarks_fetch_failed");
  }

  const atCap = bookmarksWithFlag.length === LIMIT;

  // Trip-wide split counts — computed once server-side so the segmented
  // control's labels are stable across re-renders. These are NOT affected by
  // `?cat=` or `?plan=` filters (AC 6).
  let plannedCount = 0;
  for (const b of bookmarksWithFlag) {
    if (b.planned) plannedCount += 1;
  }
  const totalCount = bookmarksWithFlag.length;
  const notPlannedCount = totalCount - plannedCount;

  // Strip `planned` off the wire shape passed to BookmarkList so the
  // `Bookmark` contract is unchanged for downstream consumers — the flag is
  // carried alongside in a parallel map keyed by bookmark id.
  const plannedByBookmarkId: Record<string, boolean> = {};
  const bookmarks = bookmarksWithFlag.map((b) => {
    plannedByBookmarkId[b.id] = b.planned;
    // Drop the helper-only fields (`planned`, `source_card_id`) from the
    // domain object exposed to the client list.
    const { planned: _planned, source_card_id: _src, ...rest } = b;
    void _planned;
    void _src;
    return rest;
  });

  // Single batched lookup of google_place_id per place_id used. Imported
  // bookmarks may have place_id = null (no Google Places enrichment yet).
  const placeIds = Array.from(
    new Set(bookmarks.map((b) => b.place_id).filter((v): v is string => v !== null)),
  );
  let googlePlaceIdByPlaceId: Record<string, string | null> = {};
  if (placeIds.length > 0) {
    const { data: placeRows, error: placeErr } = await supabase
      .from("places")
      .select("id, google_place_id")
      .in("id", placeIds);
    if (placeErr) {
      throw new Error("places_fetch_failed");
    }
    const parsedRows = PlaceIdRowSchema.array().safeParse(placeRows ?? []);
    if (!parsedRows.success) {
      throw new Error("places_parse_failed");
    }
    googlePlaceIdByPlaceId = Object.fromEntries(
      parsedRows.data.map((r) => [r.id, r.google_place_id]),
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl">
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Trip
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Places
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Bookmarked restaurants, sights and more for this trip.
          </p>
        </div>
        <Link
          href={`/trips/${encodeURIComponent(tripId)}`}
          className={secondaryButtonClass}
        >
          Back to trip
        </Link>
      </header>

      {atCap && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200"
        >
          Showing first {LIMIT} bookmarks. Refine via filters.
        </p>
      )}
      <BookmarkList
        tripId={tripId}
        role={role}
        initialBookmarks={bookmarks}
        googlePlaceIdByPlaceId={googlePlaceIdByPlaceId}
        plannedByBookmarkId={plannedByBookmarkId}
        planSplitCounts={{
          all: totalCount,
          planned: plannedCount,
          notPlanned: notPlannedCount,
        }}
      />
    </main>
  );
}
