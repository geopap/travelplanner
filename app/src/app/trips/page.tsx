import Link from "next/link";
import { TripsList } from "@/components/trips/TripsList";
import { primaryButtonClass } from "@/components/ui/FormField";

export const metadata = { title: "Your trips · TravelPlanner" };

export default function TripsPage() {
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Your trips
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            All trips you own or collaborate on.
          </p>
        </div>
        <Link href="/trips/new" className={primaryButtonClass}>
          New trip
        </Link>
      </div>
      <TripsList />
    </>
  );
}
