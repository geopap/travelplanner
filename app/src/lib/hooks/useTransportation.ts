"use client";

// B-007 — client hook for the trip-overview transport summary.
// Fetches GET /api/trips/[tripId]/transportation with pagination.
// No external state library; matches the existing fetch-based pattern.

import { useCallback, useEffect, useState } from "react";
import type { TransportationWithItem } from "@/lib/types/transportation";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";

interface ListResponse {
  items: TransportationWithItem[];
  page: number;
  limit: number;
  total: number;
}

export interface UseTransportationResult {
  status: "loading" | "ready" | "error";
  items: TransportationWithItem[];
  page: number;
  limit: number;
  total: number;
  error: string | null;
  /** Re-fetch the current page. */
  refetch: () => Promise<void>;
}

export function useTransportation(
  tripId: string,
  options: { page?: number; limit?: number } = {},
): UseTransportationResult {
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;

  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [items, setItems] = useState<TransportationWithItem[]>([]);
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
          `/api/trips/${encodeURIComponent(tripId)}/transportation` +
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
            : "Could not load transport segments. Please try again.";
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

  return { status, items, page, limit, total, error, refetch };
}
