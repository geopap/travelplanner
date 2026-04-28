// B-014 — Trip Budget tab.
//
// Server component:
//   1. Verifies the current user has at least viewer access to the trip.
//   2. Loads trip date range + base currency + total_budget.
//   3. Loads accepted members (joined with profiles) for the form/filter
//      dropdowns — same query the API uses, with `status='accepted'`.
//   4. Hands off to <ExpensesTabClient/> which renders the summary,
//      list (with filters + pagination), and add/edit forms.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkTripAccess } from "@/lib/trip-access";
import type { MemberWithProfile } from "@/lib/types/members";
import { isMemberRole, isMemberStatus } from "@/lib/types/members";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { ExpensesTabClient } from "@/components/expenses/ExpensesTabClient";

export const metadata = { title: "Budget · TravelPlanner" };
export const dynamic = "force-dynamic";

const TripRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  base_currency: z.string(),
  total_budget: z.number().nullable(),
});

const ProfileSchema = z.object({
  email: z.string(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

const MemberRowSchema = z.object({
  trip_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.string(),
  status: z.string(),
  invited_by: z.string().uuid().nullable(),
  invited_at: z.string(),
  accepted_at: z.string().nullable(),
  profile: z.union([ProfileSchema, z.array(ProfileSchema)]).nullable(),
});

export default async function TripBudgetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: tripId } = await params;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(`/sign-in?next=/trips/${encodeURIComponent(tripId)}/budget`);
  }

  const access = await checkTripAccess(supabase, tripId, auth.user.id, "viewer");
  if (!access.ok) {
    notFound();
  }

  const { data: tripRaw, error: tripErr } = await supabase
    .from("trips")
    .select("id, name, start_date, end_date, base_currency, total_budget")
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

  // Accepted members for the form dropdowns. Single-query join into
  // profiles (mirrors the public API; no N+1).
  const { data: memberRows, error: memberErr } = await supabase
    .from("trip_members")
    .select(
      "trip_id, user_id, role, status, invited_by, invited_at, accepted_at, profile:profiles!trip_members_profile_fk(email, full_name, avatar_url)",
    )
    .eq("trip_id", tripId)
    .eq("status", "accepted");
  if (memberErr) {
    throw new Error("members_load_failed");
  }

  const members: MemberWithProfile[] = [];
  for (const raw of memberRows ?? []) {
    const parsed = MemberRowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const r = parsed.data;
    if (!isMemberRole(r.role) || !isMemberStatus(r.status)) continue;
    const profileRaw = Array.isArray(r.profile)
      ? r.profile[0] ?? null
      : r.profile;
    if (!profileRaw) continue;
    members.push({
      trip_id: r.trip_id,
      user_id: r.user_id,
      role: r.role,
      status: r.status,
      invited_by: r.invited_by,
      invited_at: r.invited_at,
      accepted_at: r.accepted_at,
      profile: {
        email: profileRaw.email,
        full_name: profileRaw.full_name,
        avatar_url: profileRaw.avatar_url,
      },
    });
  }

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
            Budget
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Track expenses, see what's left of your budget, and check who
            owes whom.
          </p>
        </div>
        <Link
          href={`/trips/${encodeURIComponent(tripId)}/edit`}
          className={secondaryButtonClass}
        >
          Edit trip budget
        </Link>
      </header>

      <ExpensesTabClient
        tripId={trip.id}
        role={access.role}
        tripStartDate={trip.start_date}
        tripEndDate={trip.end_date}
        tripBaseCurrency={trip.base_currency}
        totalBudget={trip.total_budget}
        currentUserId={auth.user.id}
        members={members}
      />
    </main>
  );
}
