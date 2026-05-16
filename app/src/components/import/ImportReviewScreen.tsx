"use client";

// B-021 — Review screen for a pending import.
//
// Loads `GET /api/trips/[id]/import/[sourceId]`, renders one
// <ImportReviewCard> per extracted place and a tips list with a single
// "save as Day 1 note" toggle. Submitting POSTs to .../save, then redirects
// to the trip's Places tab with a success message via sessionStorage
// (read by the Places page if present — non-essential, swallowed on miss).

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/FormField";
import { SkeletonCard } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { llmCategoryToBookmarkCategory } from "@/lib/extract/categories";
import type {
  ExtractedPayloadT,
  ImportSourceTypeT,
} from "@/lib/validations/import";
import type { BookmarkCategory } from "@/lib/types/domain";

import {
  ImportReviewCard,
  type ReviewPlace,
} from "@/components/import/ImportReviewCard";

interface SourceResponse {
  import_source_id: string;
  source_url: string | null;
  source_type: ImportSourceTypeT;
  status: "pending" | "saved";
  created_at: string;
  extracted: ExtractedPayloadT;
}

interface SaveResponse {
  bookmark_ids: string[];
  itinerary_item_id: string | null;
}

interface ImportReviewScreenProps {
  tripId: string;
  sourceId: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string; status?: number }
  | { kind: "already_saved"; sourceUrl: string | null }
  | { kind: "ready"; source: SourceResponse };

// sessionStorage key — read by the Places page on landing to flash a toast.
const TOAST_KEY = "tp:import-toast";

export function ImportReviewScreen({
  tripId,
  sourceId,
}: ImportReviewScreenProps): React.JSX.Element {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [places, setPlaces] = useState<ReviewPlace[]>([]);
  const [saveTipsAsNote, setSaveTipsAsNote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showAutocompleteErrors, setShowAutocompleteErrors] = useState(false);
  const tipsHeadingId = useId();

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await apiFetch<SourceResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/import/${encodeURIComponent(sourceId)}`,
          { method: "GET" },
        );
        if (cancelled) return;
        if (res.status === "saved") {
          setState({ kind: "already_saved", sourceUrl: res.source_url });
          return;
        }
        const initial: ReviewPlace[] = res.extracted.places.map((p, i) => ({
          uid: `p-${i}`,
          name: p.name,
          why: p.why,
          category: llmCategoryToBookmarkCategory(p.category),
          save: true,
          googlePlaceId: null,
          resolvedName: "",
        }));
        setPlaces(initial);
        setState({ kind: "ready", source: res });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiClientError) {
          setState({
            kind: "error",
            status: err.status,
            message:
              err.status === 404
                ? "We couldn't find that import. It may have been deleted."
                : err.status === 403
                  ? "You don't have permission to view this import."
                  : err.message,
          });
          return;
        }
        setState({
          kind: "error",
          message: "Could not load this import. Please try again.",
        });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [tripId, sourceId]);

  const tips = useMemo<string[]>(() => {
    if (state.kind !== "ready") return [];
    return state.source.extracted.tips;
  }, [state]);

  const selectedCount = places.filter((p) => p.save).length;
  const selectedNeedingPlace = places.filter(
    (p) => p.save && p.googlePlaceId === null,
  ).length;
  const canSubmit =
    state.kind === "ready" &&
    !submitting &&
    (selectedCount > 0 || (saveTipsAsNote && tips.length > 0));

  function updatePlace(uid: string, next: ReviewPlace): void {
    setPlaces((prev) => prev.map((p) => (p.uid === uid ? next : p)));
  }

  async function onSave(): Promise<void> {
    if (state.kind !== "ready") return;
    if (selectedNeedingPlace > 0) {
      setShowAutocompleteErrors(true);
      setSubmitError(
        `Pick the matching Google place for ${selectedNeedingPlace} item${selectedNeedingPlace === 1 ? "" : "s"}, or untick "Save this".`,
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        confirmed_places: places.map((p) => ({
          name: p.name,
          category: p.category,
          save: p.save,
          ...(p.save && p.googlePlaceId
            ? { google_place_id: p.googlePlaceId }
            : {}),
        })),
        save_tips_as_note: saveTipsAsNote && tips.length > 0,
      };
      const result = await apiFetch<SaveResponse>(
        `/api/trips/${encodeURIComponent(tripId)}/import/${encodeURIComponent(sourceId)}/save`,
        { method: "POST", body },
      );

      const placeMsg = `Imported ${result.bookmark_ids.length} place${result.bookmark_ids.length === 1 ? "" : "s"}.`;
      const tipMsg = result.itinerary_item_id ? " + tips saved to Day 1." : "";
      try {
        window.sessionStorage.setItem(TOAST_KEY, placeMsg + tipMsg);
      } catch {
        // sessionStorage unavailable — ignore; UI still works without the toast.
      }
      router.push(`/trips/${encodeURIComponent(tripId)}/places`);
    } catch (err) {
      const message =
        err instanceof ApiClientError ? mapSaveErrorMessage(err) : null;
      setSubmitError(
        message ?? "Could not save this import. Please try again.",
      );
      setSubmitting(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="space-y-4" role="status" aria-label="Loading import">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-5 text-sm text-red-700 dark:text-red-300"
      >
        <p>{state.message}</p>
        <div className="mt-3 flex gap-2">
          <Link
            href={`/trips/${encodeURIComponent(tripId)}/import`}
            className={secondaryButtonClass}
          >
            Start a new import
          </Link>
          <Link
            href={`/trips/${encodeURIComponent(tripId)}`}
            className={secondaryButtonClass}
          >
            Back to trip
          </Link>
        </div>
      </div>
    );
  }

  if (state.kind === "already_saved") {
    return (
      <div
        role="status"
        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 text-sm text-zinc-700 dark:text-zinc-300"
      >
        <p className="font-medium text-zinc-900 dark:text-zinc-50">
          This import has already been saved.
        </p>
        {state.sourceUrl && (
          <p className="mt-1 break-all">From {state.sourceUrl}</p>
        )}
        <div className="mt-3 flex gap-2">
          <Link
            href={`/trips/${encodeURIComponent(tripId)}/places`}
            className={primaryButtonClass}
          >
            See saved places
          </Link>
          <Link
            href={`/trips/${encodeURIComponent(tripId)}/import`}
            className={secondaryButtonClass}
          >
            Start a new import
          </Link>
        </div>
      </div>
    );
  }

  // Defence in depth — backend guarantees ≥1 place or ≥1 tip, but render an
  // explicit empty state if we ever receive an empty payload.
  if (places.length === 0 && tips.length === 0) {
    return (
      <EmptyState
        icon={
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 3v18m6-18v18M3 9h18M3 15h18"
            />
          </svg>
        }
        title="Nothing to review"
        message="The extraction returned no places or tips. Try a different URL or paste the caption."
        ctaLabel="Start a new import"
        ctaHref={`/trips/${encodeURIComponent(tripId)}/import`}
      />
    );
  }

  return (
    <div className="space-y-6">
      {state.source.source_url && (
        <p className="text-xs text-zinc-500 break-all">
          Source:{" "}
          <a
            href={state.source.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {state.source.source_url}
          </a>
        </p>
      )}

      {places.length > 0 && (
        <section
          aria-label="Extracted places"
          className="space-y-3"
        >
          {places.map((p, i) => (
            <ImportReviewCard
              key={p.uid}
              place={p}
              index={i}
              onChange={(next) => updatePlace(p.uid, next)}
              showAutocompleteError={showAutocompleteErrors}
            />
          ))}
        </section>
      )}

      {tips.length > 0 && (
        <section
          aria-labelledby={tipsHeadingId}
          className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 sm:p-5"
        >
          <header className="flex items-start justify-between gap-3">
            <div>
              <h2
                id={tipsHeadingId}
                className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
              >
                Tips
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Helpful notes the extractor picked up.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700"
                checked={saveTipsAsNote}
                onChange={(e) => setSaveTipsAsNote(e.target.checked)}
              />
              Save tips as a note on Day 1
            </label>
          </header>
          <ol className="mt-4 space-y-2 text-sm text-zinc-700 dark:text-zinc-300 list-decimal list-inside">
            {tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ol>
        </section>
      )}

      {submitError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {submitError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={!canSubmit}
          aria-busy={submitting}
          onClick={onSave}
        >
          {submitting ? "Saving…" : "Save selected to trip"}
        </button>
        <Link
          href={`/trips/${encodeURIComponent(tripId)}/import`}
          className={secondaryButtonClass}
        >
          Start over
        </Link>
        <p className="text-xs text-zinc-500">
          {selectedCount} place{selectedCount === 1 ? "" : "s"} selected
          {saveTipsAsNote && tips.length > 0 ? " · tips note on" : ""}.
        </p>
      </div>
    </div>
  );
}

function mapSaveErrorMessage(err: ApiClientError): string {
  switch (err.code) {
    case "place_not_cached":
      return "One of the places hasn't been fetched from Google yet. Re-pick it from the autocomplete and try again.";
    case "bookmark_exists":
      return "A bookmark for this place and category already exists on the trip.";
    case "import_already_saved":
      return "This import was already saved.";
    case "import_source_not_found":
      return "We couldn't find this import any more.";
    case "validation_error":
      return "Please fix the highlighted fields and try again.";
    default:
      return err.message;
  }
}
