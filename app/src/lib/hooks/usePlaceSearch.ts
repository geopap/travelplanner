"use client";

// Client hook that calls GET /api/places/search with debouncing and abort.
// Per B-009: 250ms debounce, min 2 chars, AbortController on query change.
// Surfaces typed errors so consumers can render rate-limit countdowns and
// other states without re-parsing the API envelope.

import { useEffect, useState } from "react";
import type { PlaceSearchResult } from "@/lib/types/domain";
import type { PlaceCategory } from "@/lib/google/categories";

export type { PlaceSearchResult };

export type PlaceSearchError =
  | { code: "invalid_query" }
  | { code: "unauthorized" }
  | { code: "rate_limit_exceeded"; retry_after: number }
  | { code: "places_unavailable" }
  | { code: "server_error" };

interface UsePlaceSearchState {
  results: PlaceSearchResult[];
  loading: boolean;
  error: PlaceSearchError | null;
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

function isPlaceCategory(value: unknown): value is PlaceCategory {
  return (
    typeof value === "string" &&
    [
      "restaurant",
      "cafe",
      "bar",
      "sight",
      "museum",
      "shopping",
      "hotel",
      "transport_hub",
      "park",
      "other",
    ].includes(value)
  );
}

function parseResults(data: unknown): PlaceSearchResult[] {
  if (
    typeof data !== "object" ||
    data === null ||
    !("results" in data) ||
    !Array.isArray((data as { results: unknown }).results)
  ) {
    return [];
  }
  const raw = (data as { results: unknown[] }).results;
  const out: PlaceSearchResult[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (
      typeof o.google_place_id === "string" &&
      typeof o.name === "string" &&
      isPlaceCategory(o.category) &&
      (o.formatted_address === null ||
        typeof o.formatted_address === "string") &&
      (o.lat === null || typeof o.lat === "number") &&
      (o.lng === null || typeof o.lng === "number")
    ) {
      out.push({
        google_place_id: o.google_place_id,
        name: o.name,
        formatted_address:
          typeof o.formatted_address === "string" ? o.formatted_address : null,
        lat: typeof o.lat === "number" ? o.lat : null,
        lng: typeof o.lng === "number" ? o.lng : null,
        category: o.category,
      });
    }
  }
  return out;
}

function parseErrorCode(data: unknown): string | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "object" &&
    (data as { error: unknown }).error !== null
  ) {
    const err = (data as { error: Record<string, unknown> }).error;
    if (typeof err.code === "string") return err.code;
  }
  return null;
}

function toError(
  status: number,
  data: unknown,
  retryAfterHeader: string | null,
): PlaceSearchError {
  const code = parseErrorCode(data);
  if (status === 400) return { code: "invalid_query" };
  if (status === 401) return { code: "unauthorized" };
  if (status === 429) {
    const fromBody =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: { retry_after?: unknown } }).error
        ?.retry_after === "number"
        ? (data as { error: { retry_after: number } }).error.retry_after
        : null;
    const fromHeader = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : NaN;
    const retry_after =
      fromBody !== null && fromBody > 0
        ? fromBody
        : Number.isFinite(fromHeader) && fromHeader > 0
          ? fromHeader
          : 60;
    return { code: "rate_limit_exceeded", retry_after };
  }
  if (status === 502) return { code: "places_unavailable" };
  if (code === "places_unavailable") return { code: "places_unavailable" };
  return { code: "server_error" };
}

export function usePlaceSearch(query: string): UsePlaceSearchState {
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PlaceSearchError | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    const controller = new AbortController();
    let cancelled = false;

    if (trimmed.length < MIN_QUERY_LEN) {
      // Reset via microtask so we don't synchronously setState in the effect body.
      queueMicrotask(() => {
        if (cancelled) return;
        setResults([]);
        setLoading(false);
        setError(null);
      });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
    });

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/places/search?q=${encodeURIComponent(trimmed)}`,
          {
            method: "GET",
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            signal: controller.signal,
          },
        );

        const text = await response.text();
        let data: unknown = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
        }

        if (cancelled) return;

        if (!response.ok) {
          setResults([]);
          setError(
            toError(response.status, data, response.headers.get("Retry-After")),
          );
          setLoading(false);
          return;
        }

        setResults(parseResults(data));
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResults([]);
        setError({ code: "server_error" });
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  return { results, loading, error };
}
