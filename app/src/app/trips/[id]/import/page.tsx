// B-021 — Social-media import page.
//
// Two URL-driven states:
//   • Default (no query string) — <ImportPasteForm>: user pastes a URL or
//     caption text, server extracts, navigates to ?source=<id>.
//   • ?source=<uuid> — <ImportReviewScreen>: fetches the persisted
//     import_sources row by id, lets the user confirm Places autocomplete
//     hits + categories, then saves.
//
// Server component: verifies trip access (editor or owner) and renders the
// viewer-denial state inline. Viewers never see either child component.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkTripAccess } from "@/lib/trip-access";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { UuidSchema } from "@/lib/validations/common";
import { ImportPasteForm } from "@/components/import/ImportPasteForm";
import { ImportReviewScreen } from "@/components/import/ImportReviewScreen";

export const metadata = { title: "Import · TravelPlanner" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ source?: string | string[] }>;
}

export default async function TripImportPage({
  params,
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const { id: tripId } = await params;
  const { source } = await searchParams;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(`/sign-in?next=/trips/${encodeURIComponent(tripId)}/import`);
  }

  // Viewer access still loads the page so we can render an explicit denial
  // ("You don't have permission…"), matching the spike + B-021 AC role gate.
  // Non-members fall through to 404 to avoid leaking trip existence.
  const access = await checkTripAccess(
    supabase,
    tripId,
    auth.user.id,
    "viewer",
  );
  if (!access.ok) {
    notFound();
  }
  const role = access.role;
  const canImport = role === "owner" || role === "editor";

  const rawSource = Array.isArray(source) ? source[0] : source;
  const sourceId =
    rawSource && UuidSchema.safeParse(rawSource).success ? rawSource : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Trip
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Import places
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Paste a YouTube, X/Twitter or web URL — or the caption text — and
            we&apos;ll pull out places + tips for you to review.
          </p>
        </div>
        <Link
          href={`/trips/${encodeURIComponent(tripId)}`}
          className={secondaryButtonClass}
        >
          Back to trip
        </Link>
      </header>

      {!canImport ? (
        <div
          role="alert"
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 text-sm text-zinc-700 dark:text-zinc-300"
        >
          <p className="font-medium text-zinc-900 dark:text-zinc-50">
            You don&apos;t have permission to import for this trip.
          </p>
          <p className="mt-1">
            Importing is available to editors and owners. Ask the trip owner
            to upgrade your role.
          </p>
          <Link
            href={`/trips/${encodeURIComponent(tripId)}`}
            className={`${secondaryButtonClass} mt-4`}
          >
            Back to trip
          </Link>
        </div>
      ) : sourceId ? (
        <ImportReviewScreen tripId={tripId} sourceId={sourceId} />
      ) : (
        <ImportPasteForm tripId={tripId} />
      )}
    </main>
  );
}
