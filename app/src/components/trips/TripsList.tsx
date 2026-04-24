"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Paginated, Trip, MemberRole } from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeletons";
import { TripCard } from "./TripCard";
import { primaryButtonClass } from "@/components/ui/FormField";

// API shape may return either a flat list of Trip or Trip+role pairs.
// We accept both and normalize.
interface TripListItemFlat extends Trip {
  role?: MemberRole;
}

const LIMIT = 20;

export function TripsList() {
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    items: TripListItemFlat[];
    page: number;
    total: number;
    error?: string;
  }>({ status: "loading", items: [], page: 1, total: 0 });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch<Paginated<TripListItemFlat>>(
          `/api/trips?page=${state.page}&limit=${LIMIT}`,
          { method: "GET" },
        );
        if (cancelled) return;
        setState((s) => ({
          ...s,
          status: "ready",
          items: data.items,
          total: data.total,
        }));
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load your trips. Please try again.";
        setState((s) => ({ ...s, status: "error", error: message }));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [state.page]);

  if (state.status === "loading") {
    return <SkeletonList count={6} />;
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-5 text-sm text-red-700 dark:text-red-300"
      >
        {state.error}
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
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
              d="M3 7h18M5 7v13a1 1 0 001 1h12a1 1 0 001-1V7M9 7V5a3 3 0 016 0v2"
            />
          </svg>
        }
        title="No trips yet"
        message="Create your first trip and start planning days, hotels, flights and places."
        ctaLabel="Create your first trip"
        ctaHref="/trips/new"
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(state.total / LIMIT));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.items.map((trip) => (
          <TripCard key={trip.id} trip={trip} role={trip.role} />
        ))}
      </div>

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-6 flex items-center justify-center gap-2"
        >
          <button
            type="button"
            disabled={state.page <= 1}
            onClick={() =>
              setState((s) => ({
                ...s,
                status: "loading",
                page: Math.max(1, s.page - 1),
              }))
            }
            className="h-9 px-4 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-zinc-500">
            Page {state.page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={state.page >= totalPages}
            onClick={() =>
              setState((s) => ({
                ...s,
                status: "loading",
                page: Math.min(totalPages, s.page + 1),
              }))
            }
            className="h-9 px-4 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      )}

      <div className="mt-8 flex justify-center">
        <Link href="/trips/new" className={primaryButtonClass}>
          New trip
        </Link>
      </div>
    </>
  );
}
