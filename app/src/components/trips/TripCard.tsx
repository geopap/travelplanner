import Link from "next/link";
import type { MemberRole, Trip } from "@/lib/types/domain";
import {
  daysBetween,
  formatCurrency,
  formatShortDate,
} from "@/lib/utils/format";

interface TripCardProps {
  trip: Trip;
  role?: MemberRole;
}

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export function TripCard({ trip, role }: TripCardProps) {
  const days = daysBetween(trip.start_date, trip.end_date);
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="block rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 truncate">
          {trip.name}
        </h3>
        {role && (
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-zinc-600 dark:text-zinc-400">
            {ROLE_LABEL[role]}
          </span>
        )}
      </div>
      {trip.destination && (
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400 truncate">
          {trip.destination}
        </p>
      )}
      <div className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
        <span>{formatShortDate(trip.start_date)}</span>
        <span className="mx-1.5 text-zinc-400">→</span>
        <span>{formatShortDate(trip.end_date)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          {days} {days === 1 ? "day" : "days"}
        </span>
        <span>Currency: {trip.base_currency}</span>
        {trip.total_budget !== null && (
          <span>
            Budget: {formatCurrency(trip.total_budget, trip.base_currency)}
          </span>
        )}
      </div>
    </Link>
  );
}
