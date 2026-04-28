"use client";

// B-008 — single batched fetch of accommodation day indicators for a trip.
// The view returns one row per (day, accommodation) pair — multiple rows
// per day are possible when stays overlap. Consumers group by trip_day_id.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccommodationDayIndicator } from "@/lib/types/accommodations";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";

interface IndicatorResponse {
  indicators: AccommodationDayIndicator[];
}

export interface UseDayIndicatorsResult {
  status: "loading" | "ready" | "error";
  /** All indicator rows for the trip (unfiltered). */
  indicators: AccommodationDayIndicator[];
  /** Indicators grouped by trip_day_id — useful for day-card lookup. */
  byDayId: Record<string, AccommodationDayIndicator[]>;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDayIndicators(tripId: string): UseDayIndicatorsResult {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [indicators, setIndicators] = useState<AccommodationDayIndicator[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function run() {
      setStatus("loading");
      setError(null);
      try {
        const data = await apiFetch<IndicatorResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/day-indicators`,
          { method: "GET", signal: controller.signal },
        );
        if (cancelled) return;
        setIndicators(data.indicators);
        setStatus("ready");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load accommodation indicators.";
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

  const byDayId = useMemo(() => {
    const out: Record<string, AccommodationDayIndicator[]> = {};
    for (const row of indicators) {
      const list = out[row.trip_day_id];
      if (list) list.push(row);
      else out[row.trip_day_id] = [row];
    }
    return out;
  }, [indicators]);

  const refetch = useCallback(async () => {
    setRefetchKey((k) => k + 1);
  }, []);

  return { status, indicators, byDayId, error, refetch };
}
