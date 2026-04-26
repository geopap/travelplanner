import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { checkTripAccess } from "@/lib/trip-access";
import { MembersPanel } from "@/components/members/MembersPanel";
import { secondaryButtonClass } from "@/components/ui/FormField";

export const metadata = { title: "Members · TravelPlanner" };

export default async function TripMembersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { user, supabase } = await getSessionUser();
  if (!user) {
    redirect(`/sign-in?redirect=${encodeURIComponent(`/trips/${id}/members`)}`);
  }

  const access = await checkTripAccess(supabase, id, user.id, "viewer");
  if (!access.ok) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-5 text-sm text-red-700 dark:text-red-300"
      >
        Trip not found or you no longer have access.
        <div className="mt-3">
          <Link href="/trips" className={secondaryButtonClass}>
            Back to trips
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = access.role === "owner";

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Trip members
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 mt-1">
            Invite partners
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Invite people to collaborate on this trip.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/trips/${id}`} className={secondaryButtonClass}>
            Back to trip
          </Link>
        </div>
      </div>

      {isOwner ? (
        <MembersPanel tripId={id} />
      ) : (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-center">
          <div
            className="mx-auto mb-3 w-12 h-12 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-6 h-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 11c2.21 0 4-1.79 4-4S14.21 3 12 3 8 4.79 8 7s1.79 4 4 4zM4 21a8 8 0 0116 0"
              />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            Only the trip owner can invite members.
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Ask the owner to send you an invite if you need a different role.
          </p>
        </div>
      )}
    </>
  );
}
