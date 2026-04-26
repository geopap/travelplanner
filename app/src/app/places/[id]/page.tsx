// Server component: `/places/[id]` where `[id]` = google_place_id.
//
// Fetches the place detail via the internal API route with the request's
// session cookies forwarded so the route's `requireAuth()` succeeds. Errors
// are mapped to friendly UI states:
//   - 401 → not-found (the proxy/middleware enforces auth on this page already
//           but we still render a generic state if a session race occurs).
//   - 404 / `place_not_found` → not-found state.
//   - 502 / `places_unavailable` → friendly "service unavailable" state.
//   - any other failure → throw to the closest `error.tsx` boundary.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { PlaceDetail } from "@/lib/types/domain";
import { PlaceDetailView } from "@/components/places/PlaceDetailView";
import { BookmarkButton } from "@/components/places/BookmarkButton";
import { getSessionUser } from "@/lib/supabase/server";

export const metadata = { title: "Place · TravelPlanner" };
export const dynamic = "force-dynamic";

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function resolveSiteOrigin(): Promise<string> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  if (host) return `${proto}://${host}`;
  return "http://localhost:3000";
}

type FetchResult =
  | { kind: "ok"; detail: PlaceDetail }
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "error" };

async function fetchPlaceDetail(googlePlaceId: string): Promise<FetchResult> {
  const origin = await resolveSiteOrigin();
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const url = `${origin}/api/places/${encodeURIComponent(googlePlaceId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      cache: "no-store",
    });
  } catch {
    return { kind: "error" };
  }

  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 502) return { kind: "unavailable" };
  if (!res.ok) {
    // Try to read the API error envelope before falling back.
    try {
      const body = (await res.json()) as ApiErrorBody;
      if (body?.error?.code === "place_not_found") return { kind: "not_found" };
      if (body?.error?.code === "places_unavailable") {
        return { kind: "unavailable" };
      }
    } catch {
      // ignore — fall through
    }
    return { kind: "error" };
  }

  try {
    const detail = (await res.json()) as PlaceDetail;
    if (typeof detail?.google_place_id !== "string") {
      return { kind: "error" };
    }
    return { kind: "ok", detail };
  } catch {
    return { kind: "error" };
  }
}

function ServiceUnavailable() {
  return (
    <main
      role="alert"
      className="mx-auto w-full max-w-md px-4 py-12 text-center sm:px-6"
    >
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Place details unavailable
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        The Places service didn&apos;t respond in time. Please try again
        shortly.
      </p>
    </main>
  );
}

export default async function PlaceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await fetchPlaceDetail(id);

  if (result.kind === "not_found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <ServiceUnavailable />;
  }
  if (result.kind === "error") {
    throw new Error("place_detail_fetch_failed");
  }

  const { user } = await getSessionUser();
  const bookmarkSlot = user ? (
    <BookmarkButton
      googlePlaceId={result.detail.google_place_id}
      placeCategory={result.detail.category}
      placeName={result.detail.name}
    />
  ) : null;

  return <PlaceDetailView detail={result.detail} bookmarkSlot={bookmarkSlot} />;
}
