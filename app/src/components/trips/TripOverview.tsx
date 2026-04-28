"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  MemberRole,
  Trip,
  TripDay,
} from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import {
  daysBetween,
  formatCurrency,
  formatDate,
} from "@/lib/utils/format";
import { SkeletonCard } from "@/components/Skeletons";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { TransportSummary } from "@/components/trip-overview/TransportSummary";
import { AccommodationsSummary } from "@/components/accommodations/AccommodationsSummary";
import { ExpensesSummary } from "@/components/expenses/ExpensesSummary";
import {
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/FormField";

interface TripOverviewProps {
  tripId: string;
}

interface TripDetailResponse {
  trip: Trip;
  member: { role: MemberRole };
}

export function TripOverview({ tripId }: TripOverviewProps) {
  const router = useRouter();
  const [state, setState] = useState<{
    status: "loading" | "ready" | "error";
    trip?: Trip;
    role?: MemberRole;
    dayCount?: number;
    dayCountFallback?: boolean;
    error?: string;
  }>({ status: "loading" });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch detail and days in parallel — they are independent.
        const detailPromise = apiFetch<TripDetailResponse>(
          `/api/trips/${tripId}`,
          { method: "GET" },
        );
        const daysPromise = apiFetch<{ items: TripDay[] }>(
          `/api/trips/${tripId}/days`,
          { method: "GET" },
        ).then(
          (res) => ({ ok: true as const, items: res.items }),
          (err: unknown) => ({ ok: false as const, err }),
        );
        const [detail, daysOutcome] = await Promise.all([
          detailPromise,
          daysPromise,
        ]);
        if (cancelled) return;

        let dayCount: number;
        let dayCountFallback = false;
        if (daysOutcome.ok) {
          dayCount = daysOutcome.items.length;
        } else {
          dayCount = daysBetween(detail.trip.start_date, detail.trip.end_date);
          dayCountFallback = true;
        }

        setState({
          status: "ready",
          trip: detail.trip,
          role: detail.member.role,
          dayCount,
          dayCountFallback,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError && err.status === 404
            ? "Trip not found or you no longer have access."
            : err instanceof ApiClientError
            ? err.message
            : "Could not load this trip. Please try again.";
        setState({ status: "error", error: message });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  async function onConfirmDelete() {
    if (!state.trip) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch<void>(`/api/trips/${state.trip.id}`, {
        method: "DELETE",
        headers: { "X-Confirm-Name": state.trip.name },
      });
      router.replace("/trips");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the trip. Please try again.";
      setDeleteError(message);
      setDeleting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (state.status === "error" || !state.trip || !state.role) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-5 text-sm text-red-700 dark:text-red-300"
      >
        {state.error ?? "Trip unavailable."}
        <div className="mt-3">
          <Link
            href="/trips"
            className={secondaryButtonClass}
          >
            Back to trips
          </Link>
        </div>
      </div>
    );
  }

  const { trip, role, dayCount, dayCountFallback } = state;
  const canEdit = role === "owner" || role === "editor";
  const canDelete = role === "owner";

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            {role === "owner"
              ? "You own this trip"
              : role === "editor"
              ? "You are an editor"
              : "You are a viewer"}
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mt-1">
            {trip.name}
          </h1>
          {trip.destination && (
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              {trip.destination}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/trips/${trip.id}/itinerary`}
            className={primaryButtonClass}
          >
            Open itinerary
          </Link>
          <Link
            href={`/trips/${trip.id}/budget`}
            className={secondaryButtonClass}
          >
            Budget
          </Link>
          {canEdit && (
            <Link
              href={`/trips/${trip.id}/edit`}
              className={secondaryButtonClass}
            >
              Edit trip
            </Link>
          )}
          <Link
            href={`/trips/${trip.id}/members`}
            className={secondaryButtonClass}
          >
            Members
          </Link>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Start" value={formatDate(trip.start_date)} />
        <Stat label="End" value={formatDate(trip.end_date)} />
        <Stat
          label="Duration"
          value={`${dayCount ?? daysBetween(trip.start_date, trip.end_date)} days`}
          note={
            dayCountFallback
              ? "Could not load days — showing computed count"
              : undefined
          }
        />
        <Stat
          label="Budget"
          value={
            trip.total_budget !== null
              ? formatCurrency(trip.total_budget, trip.base_currency)
              : `Not set (${trip.base_currency})`
          }
        />
      </dl>

      <ExpensesSummary
        tripId={trip.id}
        totalBudget={trip.total_budget}
        tripBaseCurrency={trip.base_currency}
        variant="compact"
      />

      <TransportSummary tripId={trip.id} canEdit={canEdit} />

      <AccommodationsSummary tripId={trip.id} canEdit={canEdit} />

      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/trips/${trip.id}/accommodations`}
            className={secondaryButtonClass}
          >
            Manage accommodations
          </Link>
        </div>
      )}

      {canDelete && (
        <div className="mt-10 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/30 p-5">
          <h2 className="text-sm font-semibold text-red-800 dark:text-red-200">
            Danger zone
          </h2>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            Deleting the trip removes all days, items, bookmarks and expenses.
            This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
            className={`${dangerButtonClass} mt-3`}
          >
            Delete trip
          </button>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteOpen}
        title="Delete this trip?"
        description={`This will permanently delete “${trip.name}” and all its contents.`}
        requireTypedName={trip.name}
        confirmLabel="Delete trip"
        busy={deleting}
        error={deleteError}
        onConfirm={onConfirmDelete}
        onCancel={() => {
          if (deleting) return;
          setDeleteOpen(false);
        }}
      />
    </>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {value}
      </dd>
      {note && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
    </div>
  );
}
