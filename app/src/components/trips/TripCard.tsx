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

type TripStatus = "upcoming" | "ongoing" | "past";

const STATUS_LABEL: Record<TripStatus, string> = {
  upcoming: "Upcoming",
  ongoing: "Ongoing",
  past: "Past",
};

const STATUS_CHIP_CLASS: Record<TripStatus, string> = {
  upcoming:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  ongoing:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  past: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

/**
 * Derive the trip's status from its YYYY-MM-DD date range vs today's local
 * date. String comparison on ISO date-only values avoids TZ parsing issues.
 */
function tripStatus(startIso: string, endIso: string): TripStatus {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (endIso < today) return "past";
  if (startIso > today) return "upcoming";
  return "ongoing";
}

export function TripCard({ trip, role }: TripCardProps) {
  const days = daysBetween(trip.start_date, trip.end_date);
  const status = tripStatus(trip.start_date, trip.end_date);
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="block rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:border-zinc-400 dark:hover:border-zinc-600 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 truncate">
          {trip.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${STATUS_CHIP_CLASS[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
          {role && (
            <span className="text-[11px] font-medium uppercase tracking-wide rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-zinc-600 dark:text-zinc-400">
              {ROLE_LABEL[role]}
            </span>
          )}
        </div>
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
