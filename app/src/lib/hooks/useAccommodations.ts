"use client";

// B-008 — client hooks/wrappers for the accommodations API.
// Mirrors the pattern of useTransportation: simple state machine + apiFetch.

import { useCallback, useEffect, useState } from "react";
import type {
  Accommodation,
  AccommodationCreateDTO,
  AccommodationPatchDTO,
  AccommodationWithPlace,
} from "@/lib/types/accommodations";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";

interface ListResponse {
  items: AccommodationWithPlace[];
  page: number;
  limit: number;
  total: number;
}

export interface UseAccommodationsResult {
  status: "loading" | "ready" | "error";
  items: AccommodationWithPlace[];
  page: number;
  limit: number;
  total: number;
  error: string | null;
  refetch: () => Promise<void>;
  setPage: (page: number) => void;
}

export function useAccommodations(
  tripId: string,
  options: { initialPage?: number; limit?: number } = {},
): UseAccommodationsResult {
  const limit = options.limit ?? 20;
  const [page, setPage] = useState(options.initialPage ?? 1);

  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [items, setItems] = useState<AccommodationWithPlace[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function run() {
      setStatus("loading");
      setError(null);
      try {
        const data = await apiFetch<ListResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/accommodations` +
            `?page=${page}&limit=${limit}`,
          { method: "GET", signal: controller.signal },
        );
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
        setStatus("ready");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load accommodations. Please try again.";
        setError(message);
        setStatus("error");
      }
    }
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tripId, page, limit, refetchKey]);

  const refetch = useCallback(async () => {
    setRefetchKey((k) => k + 1);
  }, []);

  return { status, items, page, limit, total, error, refetch, setPage };
}

// ----------------------------------------------------------------------------
// Mutation wrappers — thin promises so callers can show their own busy state.
// Server error codes are surfaced via ApiClientError.code.
// ----------------------------------------------------------------------------

export interface AccommodationMutationResponse {
  accommodation: AccommodationWithPlace;
}

export async function createAccommodation(
  tripId: string,
  body: AccommodationCreateDTO,
): Promise<AccommodationWithPlace> {
  const res = await apiFetch<AccommodationMutationResponse>(
    `/api/trips/${encodeURIComponent(tripId)}/accommodations`,
    { method: "POST", body },
  );
  return res.accommodation;
}

export async function updateAccommodation(
  tripId: string,
  accommodationId: string,
  body: AccommodationPatchDTO,
): Promise<AccommodationWithPlace> {
  const res = await apiFetch<AccommodationMutationResponse>(
    `/api/trips/${encodeURIComponent(tripId)}/accommodations/${encodeURIComponent(
      accommodationId,
    )}`,
    { method: "PATCH", body },
  );
  return res.accommodation;
}

export async function deleteAccommodation(
  tripId: string,
  accommodationId: string,
): Promise<void> {
  await apiFetch<void>(
    `/api/trips/${encodeURIComponent(tripId)}/accommodations/${encodeURIComponent(
      accommodationId,
    )}`,
    { method: "DELETE" },
  );
}

// Re-export the row type for callers that don't already import it.
export type { Accommodation, AccommodationWithPlace };
