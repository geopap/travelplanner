"use client";

// B-011 — minimal client hook for refetching the bookmarks list after a
// mutation. The Places tab page renders the initial list server-side; this
// hook provides client-side refetch after create/update/delete inside the
// dialog flows.
//
// Returns:
//   - bookmarks: latest list (initialised from the SSR-supplied seed)
//   - loading:  true while a refetch is in-flight
//   - error:    user-facing message when refetch failed
//   - refetch(): triggers a re-fetch of GET /api/trips/[tripId]/bookmarks

import { useCallback, useState } from "react";
import type { Bookmark } from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";

interface ListResponse {
  bookmarks: Bookmark[];
  page: number;
  limit: number;
  total: number;
}

export interface UseBookmarksResult {
  bookmarks: Bookmark[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useBookmarks(
  tripId: string,
  initial: Bookmark[],
): UseBookmarksResult {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<ListResponse>(
        `/api/trips/${encodeURIComponent(tripId)}/bookmarks?limit=200`,
        { method: "GET" },
      );
      setBookmarks(data.bookmarks);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not refresh bookmarks. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  return { bookmarks, loading, error, refetch };
}
