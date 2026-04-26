// B-011 — Places (Bookmarks) tab for a trip.
//
// Server component:
//   1. Verifies the current user has at least viewer access to the trip
//      (defense-in-depth on top of RLS).
//   2. Loads up to 200 bookmarks for the trip with the joined slim place row.
//   3. Resolves google_place_id per bookmark via a single batched query
//      against `places` (avoids N+1).
//   4. Hands off to the client `BookmarkList`, gated by the viewer's role.

import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkTripAccess } from "@/lib/trip-access";
import { BookmarkList } from "@/components/bookmarks/BookmarkList";
import { EmptyState } from "@/components/EmptyState";
import { secondaryButtonClass } from "@/components/ui/FormField";
import {
  BookmarkRowSchema,
  mapBookmarkRow,
} from "@/lib/validations/bookmarks";

export const metadata = { title: "Places · TravelPlanner" };
export const dynamic = "force-dynamic";

const LIMIT = 200;

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
    redirect(`/sign-in?next=/trips/${encodeURIComponent(tripId)}/places`);
  }

  const access = await checkTripAccess(supabase, tripId, auth.user.id, "viewer");
  if (!access.ok) {
    notFound();
  }
  const role = access.role;

  // Direct Supabase query — RLS already restricts to trip members. We bound
  // the result at LIMIT and join the slim place fields used by the UI.
  const { data: bookmarksRaw, error } = await supabase
    .from("bookmarks")
    .select(
      "id, trip_id, place_id, category, notes, added_by, created_at, updated_at, place:places(name, formatted_address, category, lat, lng)",
    )
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    throw new Error("bookmarks_fetch_failed");
  }

  const parsedBookmarks = BookmarkRowSchema.array().safeParse(
    bookmarksRaw ?? [],
  );
  if (!parsedBookmarks.success) {
    throw new Error("bookmarks_parse_failed");
  }
  const bookmarks = parsedBookmarks.data.map(mapBookmarkRow);
  const atCap = bookmarks.length === LIMIT;

  // Single batched lookup of google_place_id per place_id used.
  const placeIds = Array.from(new Set(bookmarks.map((b) => b.place_id)));
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
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
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

      {bookmarks.length === 0 ? (
        <EmptyState
          icon={
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"
              />
            </svg>
          }
          title="No bookmarks yet"
          message="Open a place's detail page to add one."
          ctaLabel="Back to trip"
          ctaHref={`/trips/${encodeURIComponent(tripId)}`}
        />
      ) : (
        <>
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
          />
        </>
      )}
    </main>
  );
}
