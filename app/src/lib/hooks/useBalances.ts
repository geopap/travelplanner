"use client";

// B-014 — Client hook for trip balances.
// GET /api/trips/[id]/balances returns one row per accepted member,
// sorted by net DESC, with display profile fields attached.

import { useCallback, useEffect, useState } from "react";
import type { TripBalance } from "@/lib/types/expenses";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";

interface BalancesResponse {
  balances: TripBalance[];
}

export interface UseBalancesResult {
  status: "loading" | "ready" | "error";
  balances: TripBalance[];
  error: string | null;
  refetch: () => Promise<void>;
}

export function useBalances(tripId: string): UseBalancesResult {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [balances, setBalances] = useState<TripBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function run() {
      setStatus("loading");
      setError(null);
      try {
        const data = await apiFetch<BalancesResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/balances`,
          { method: "GET", signal: controller.signal },
        );
        if (cancelled) return;
        setBalances(data.balances);
        setStatus("ready");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load balances. Please try again.";
        setError(message);
        setStatus("error");
      }
    }
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tripId, refetchKey]);

  const refetch = useCallback(async () => {
    setRefetchKey((k) => k + 1);
  }, []);

  return { status, balances, error, refetch };
}

export type { TripBalance };
