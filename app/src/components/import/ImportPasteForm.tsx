"use client";

// B-021 / B-035 — Paste form for social-media import.
//
// One URL field OR one caption textarea. Submit calls
// POST /api/trips/[id]/import/extract; on success we push the user to the
// review screen via ?source=<id>. Backend error codes are mapped to inline
// messages — duplicate_recent_import gets a "View previous results" link.
//
// B-035: detect Instagram/TikTok hostnames pre-submit and surface a banner
// that one-clicks the user into caption mode while stashing the URL as
// `stashed_source_url` for traceability. "Try anyway" dismisses the banner
// for the current paste only (the post-submit `unsupported_source` error
// remains the safety net).

import { useEffect, useMemo, useRef, useState } from "react";
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
import { isCaptionOnlyHost } from "@/lib/utils/import-hosts";

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
  // B-035 state ----------------------------------------------------------
  // `stashedSourceUrl` — set when the user clicks "Switch to caption mode".
  // While non-null, the URL field is hidden/disabled and the caption-mode
  // submit posts both `raw_text` and `stashed_source_url`.
  const [stashedSourceUrl, setStashedSourceUrl] = useState<string | null>(null);
  // `bannerDismissed` — set when the user clicks "Try anyway" so the banner
  // stays hidden for the current paste. Cleared when the URL text changes.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const trimmedUrl = url.trim();
  const trimmedText = rawText.trim();
  const hasUrl = trimmedUrl.length > 0;
  const hasText = trimmedText.length > 0;
  const inCaptionMode = stashedSourceUrl !== null;
  // Exactly one — matches the ExtractInput union.
  // In caption-mode the URL field is hidden, so only text is required.
  const canSubmit = inCaptionMode
    ? hasText && !submitting
    : (hasUrl !== hasText) && !submitting;

  // B-035 — detect Instagram/TikTok host on the typed URL.
  const showCaptionBanner = useMemo(() => {
    if (inCaptionMode || bannerDismissed) return false;
    if (!hasUrl) return false;
    return isCaptionOnlyHost(trimmedUrl);
  }, [bannerDismissed, hasUrl, inCaptionMode, trimmedUrl]);

  const previousResultsHref = useMemo(() => {
    if (error?.kind !== "duplicate" || !error.duplicateSourceId) return null;
    return `/trips/${encodeURIComponent(tripId)}/import?source=${encodeURIComponent(error.duplicateSourceId)}`;
  }, [error, tripId]);

  function switchToCaptionMode(): void {
    if (!hasUrl) return;
    setStashedSourceUrl(trimmedUrl);
    setUrl("");
    setBannerDismissed(false);
    setError(null);
    // Focus the textarea on the next paint.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function clearStashedUrl(): void {
    setStashedSourceUrl(null);
  }

  // If the user clears the textarea while in caption-mode they probably want
  // out — but we don't auto-exit; they can use the "Use a different URL"
  // affordance below the banner-state. (Intentional — avoids losing the
  // stashed URL on a stray keystroke.)
  useEffect(() => {
    // If they paste a new URL after dismissing, re-enable the banner check.
    if (bannerDismissed && !hasUrl) setBannerDismissed(false);
  }, [bannerDismissed, hasUrl]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body:
        | { source_url: string }
        | { raw_text: string }
        | { raw_text: string; stashed_source_url: string } = inCaptionMode
        ? { raw_text: trimmedText, stashed_source_url: stashedSourceUrl as string }
        : hasUrl
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
      {showCaptionBanner && (
        <div
          role="status"
          aria-live="polite"
          data-testid="caption-mode-banner"
          className="rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/40 p-4 text-sm text-sky-900 dark:text-sky-100 space-y-3"
        >
          <p className="font-medium">
            Instagram and TikTok don&apos;t share post text with servers. Paste
            the caption below instead — we&apos;ll save your link as a reference.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <button
              type="button"
              onClick={switchToCaptionMode}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-700 hover:bg-sky-800 text-white px-4 text-sm font-medium"
            >
              Switch to caption mode
            </button>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              className="inline-flex min-h-11 items-center justify-center px-2 text-sm underline underline-offset-2 text-sky-900 dark:text-sky-100"
            >
              Try anyway
            </button>
          </div>
        </div>
      )}

      {inCaptionMode && (
        <div
          role="status"
          aria-live="polite"
          data-testid="stashed-url-chip"
          className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm text-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-3"
        >
          <span className="truncate">
            <span className="text-zinc-500 dark:text-zinc-400">Link saved:</span>{" "}
            <span className="font-medium">{stashedSourceUrl}</span>
          </span>
          <button
            type="button"
            onClick={clearStashedUrl}
            className="shrink-0 text-xs underline underline-offset-2 text-zinc-600 dark:text-zinc-300"
          >
            Use a different URL
          </button>
        </div>
      )}

      {!inCaptionMode && (
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
              if (bannerDismissed) setBannerDismissed(false);
              if (error) setError(null);
            }}
            onBlur={() => {
              // No-op — host detection already runs on every keystroke via
              // showCaptionBanner. The blur handler is here for AC #1 spec
              // compatibility; the memoised computation already covers it.
            }}
            disabled={submitting || hasText}
            aria-describedby="import-or-divider"
          />
        </FormField>
      )}

      {!inCaptionMode && (
        <p
          id="import-or-divider"
          className="text-center text-xs uppercase tracking-wider text-zinc-500"
        >
          or paste caption text
        </p>
      )}

      <FormField
        id="import-text"
        label={inCaptionMode ? "Caption text" : "Caption text"}
        hint={
          inCaptionMode
            ? "Paste the post caption from Instagram or TikTok."
            : "Use this for Instagram, TikTok or anything we can't fetch."
        }
      >
        <textarea
          ref={textareaRef}
          id="import-text"
          className={`${textareaClass} min-h-32`}
          placeholder="Paste the post caption or transcript here…"
          maxLength={20000}
          value={rawText}
          onChange={(e) => {
            setRawText(e.target.value);
            if (error) setError(null);
          }}
          disabled={submitting || (!inCaptionMode && hasUrl)}
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
        {!inCaptionMode && hasUrl && hasText && (
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
