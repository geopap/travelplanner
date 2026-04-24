"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MemberRole, Trip } from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { SkeletonCard } from "@/components/Skeletons";
import { TripForm } from "./TripForm";
import { secondaryButtonClass } from "@/components/ui/FormField";

interface TripEditLoaderProps {
  tripId: string;
}

interface TripDetailResponse {
  trip: Trip;
  member: { role: MemberRole };
}

export function TripEditLoader({ tripId }: TripEditLoaderProps) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; trip: Trip }
    | { status: "forbidden" }
    | { status: "error"; message: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await apiFetch<TripDetailResponse>(
          `/api/trips/${tripId}`,
          { method: "GET" },
        );
        if (cancelled) return;
        if (data.member.role !== "owner") {
          setState({ status: "forbidden" });
          return;
        }
        setState({ status: "ready", trip: data.trip });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError && err.status === 404
            ? "Trip not found."
            : err instanceof ApiClientError
            ? err.message
            : "Could not load this trip.";
        setState({ status: "error", message });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  if (state.status === "loading") {
    return <SkeletonCard />;
  }

  if (state.status === "forbidden") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 p-5 text-sm text-amber-800 dark:text-amber-200"
      >
        Only the trip owner can edit trip settings.
        <div className="mt-3">
          <Link href={`/trips/${tripId}`} className={secondaryButtonClass}>
            Back to trip
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-5 text-sm text-red-700 dark:text-red-300"
      >
        {state.message}
      </div>
    );
  }

  return <TripForm mode="edit" initial={state.trip} />;
}
