"use client";

// B-021 — Paste form for social-media import.
//
// One URL field OR one caption textarea. Submit calls
// POST /api/trips/[id]/import/extract; on success we push the user to the
// review screen via ?source=<id>. Backend error codes are mapped to inline
// messages — duplicate_recent_import gets a "View previous results" link.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  FormField,
  inputClass,
  primaryButtonClass,
  textareaClass,
} from "@/components/ui/FormField";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import type { ExtractedPayloadT, ImportSourceTypeT } from "@/lib/validations/import";

interface ExtractResponse {
  import_source_id: string;
  source_type: ImportSourceTypeT;
  captions_unavailable: boolean;
  extracted: ExtractedPayloadT;
}

interface InlineError {
  kind:
    | "unsupported_source"
    | "source_fetch_failed"
    | "rate_limited"
    | "duplicate"
    | "zero_results"
    | "llm_unavailable"
    | "validation"
    | "generic";
  message: string;
  retryAfterSeconds?: number;
  duplicateSourceId?: string;
}

interface ImportPasteFormProps {
  tripId: string;
}

export function ImportPasteForm({ tripId }: ImportPasteFormProps): React.JSX.Element {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<InlineError | null>(null);

  const trimmedUrl = url.trim();
  const trimmedText = rawText.trim();
  const hasUrl = trimmedUrl.length > 0;
  const hasText = trimmedText.length > 0;
  // Exactly one — matches the ExtractInput zod refine.
  const canSubmit = (hasUrl !== hasText) && !submitting;

  const previousResultsHref = useMemo(() => {
    if (error?.kind !== "duplicate" || !error.duplicateSourceId) return null;
    return `/trips/${encodeURIComponent(tripId)}/import?source=${encodeURIComponent(error.duplicateSourceId)}`;
  }, [error, tripId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: { source_url?: string; raw_text?: string } = hasUrl
        ? { source_url: trimmedUrl }
        : { raw_text: trimmedText };
      const res = await apiFetch<ExtractResponse>(
        `/api/trips/${encodeURIComponent(tripId)}/import/extract`,
        { method: "POST", body },
      );
      router.push(
        `/trips/${encodeURIComponent(tripId)}/import?source=${encodeURIComponent(res.import_source_id)}`,
      );
    } catch (err) {
      setError(mapError(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <FormField
        id="import-url"
        label="URL"
        hint="YouTube, X/Twitter, or any web page."
      >
        <input
          id="import-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (error) setError(null);
          }}
          disabled={submitting || hasText}
          aria-describedby="import-or-divider"
        />
      </FormField>

      <p
        id="import-or-divider"
        className="text-center text-xs uppercase tracking-wider text-zinc-500"
      >
        or paste caption text
      </p>

      <FormField
        id="import-text"
        label="Caption text"
        hint="Use this for Instagram, TikTok or anything we can't fetch."
      >
        <textarea
          id="import-text"
          className={`${textareaClass} min-h-32`}
          placeholder="Paste the post caption or transcript here…"
          maxLength={20000}
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            if (error) setError(null);
          }}
          disabled={submitting || hasUrl}
        />
      </FormField>

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-900 dark:text-amber-200"
        >
          <p>{error.message}</p>
          {previousResultsHref && (
            <Link
              href={previousResultsHref}
              className="mt-2 inline-block font-medium text-amber-900 dark:text-amber-100 underline underline-offset-2"
            >
              View previous results
            </Link>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={!canSubmit}
          aria-busy={submitting}
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Extracting…
            </span>
          ) : (
            "Extract places"
          )}
        </button>
        {hasUrl && hasText && (
          <p className="text-xs text-zinc-500">
            Use either a URL or pasted text — not both.
          </p>
        )}
      </div>
    </form>
  );
}

function Spinner(): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100"
    />
  );
}

function mapError(err: unknown): InlineError {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case "unsupported_source":
      case "source_fetch_failed":
        return {
          kind: err.code === "unsupported_source" ? "unsupported_source" : "source_fetch_failed",
          message:
            "We couldn't fetch that URL. Paste the caption text instead.",
        };
      case "rate_limit_exceeded": {
        const raw = err.details?.retry_after_seconds;
        const seconds = typeof raw === "number" && raw > 0 ? raw : 3600;
        return {
          kind: "rate_limited",
          message: `You've hit the 20 imports/hour limit. Try again in ${formatRetry(seconds)}.`,
          retryAfterSeconds: seconds,
        };
      }
      case "duplicate_recent_import": {
        const dup = err.details?.import_source_id;
        return {
          kind: "duplicate",
          message: "You imported this URL already (last 24h).",
          duplicateSourceId: typeof dup === "string" ? dup : undefined,
        };
      }
      case "extraction_empty":
        return {
          kind: "zero_results",
          message:
            "We couldn't find any places in that source. Try a different URL or paste the caption.",
        };
      case "llm_unavailable":
        return {
          kind: "llm_unavailable",
          message:
            "Extraction service is temporarily unavailable. Please try again in a moment.",
        };
      case "validation_error":
        return {
          kind: "validation",
          message: "Please provide exactly one of a URL or caption text.",
        };
      default:
        return { kind: "generic", message: err.message };
    }
  }
  return {
    kind: "generic",
    message: "Something went wrong. Please try again.",
  };
}

function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  return `${hours}h`;
}
