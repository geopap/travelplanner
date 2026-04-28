import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { checkTripAccess } from "@/lib/trip-access";
import { MembersPanel } from "@/components/members/MembersPanel";
import { MembersList } from "@/components/members/MembersList";
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

      {isOwner && <MembersPanel tripId={id} />}

      <section className={isOwner ? "mt-8" : undefined}>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
          Members
        </h2>
        <MembersList
          tripId={id}
          currentUserId={user.id}
          isOwner={isOwner}
        />
      </section>

      {!isOwner && (
        <p className="mt-6 text-sm text-zinc-500">
          Ask the trip owner to invite more partners or change your role.
        </p>
      )}
    </>
  );
}
