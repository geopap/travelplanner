// Trip Transport management page — mirrors /accommodations.
// Lists every transport segment with edit/delete; "Add transport" opens the
// shared <ItineraryItemForm/> in transport mode.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkTripAccess } from "@/lib/trip-access";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { TransportationTabClient } from "@/components/transportation/TransportationTabClient";

export const metadata = { title: "Transport · TravelPlanner" };
export const dynamic = "force-dynamic";

const TripRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  base_currency: z.string(),
});

export default async function TripTransportationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: tripId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(
      `/sign-in?next=/trips/${encodeURIComponent(tripId)}/transportation`,
    );
  }

  const access = await checkTripAccess(supabase, tripId, auth.user.id, "viewer");
  if (!access.ok) {
    notFound();
  }

  const { data: tripRaw, error: tripErr } = await supabase
    .from("trips")
    .select("id, name, start_date, end_date, base_currency")
    .eq("id", tripId)
    .maybeSingle();
  if (tripErr || !tripRaw) {
    notFound();
  }

  const tripParsed = TripRowSchema.safeParse(tripRaw);
  if (!tripParsed.success) {
    throw new Error("trip_parse_failed");
  }
  const trip = tripParsed.data;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Link
            href={`/trips/${encodeURIComponent(tripId)}`}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ← {trip.name}
          </Link>
          <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Transport
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Flights, trains, ferries and other segments for this trip — listed
            in departure order.
          </p>
        </div>
        <Link
          href={`/trips/${encodeURIComponent(tripId)}/itinerary`}
          className={secondaryButtonClass}
        >
          Open itinerary
        </Link>
      </header>

      <TransportationTabClient
        tripId={trip.id}
        role={access.role}
        tripBaseCurrency={trip.base_currency}
      />
    </main>
  );
}
