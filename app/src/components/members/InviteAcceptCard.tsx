"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError } from "@/lib/utils/api-client";
import { acceptInvitation } from "@/lib/hooks/useInvitations";
import { primaryButtonClass } from "@/components/ui/FormField";
import {
  InviteErrorState,
  type InviteErrorVariant,
} from "@/components/members/InviteErrorState";

interface InviteAcceptCardProps {
  token: string;
  tripName: string;
  role: string;
  inviterName: string;
  expiresAt: string;
}

const EXPIRES_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function roleLabel(role: string): string {
  if (role === "editor") return "Editor";
  if (role === "viewer") return "Viewer";
  if (role === "owner") return "Owner";
  return role;
}

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return EXPIRES_FORMATTER.format(d);
}

export function InviteAcceptCard({
  token,
  tripName,
  role,
  inviterName,
  expiresAt,
}: InviteAcceptCardProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorVariant, setErrorVariant] = useState<InviteErrorVariant | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);

  async function onAccept() {
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await acceptInvitation(token);
      router.replace(`/trips/${res.trip_id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 404) {
          setErrorVariant("invalid");
        } else if (err.status === 410) {
          // 410 used for both expired and revoked. Disambiguate by code if present.
          if (err.code === "token_revoked") setErrorVariant("revoked");
          else setErrorVariant("expired");
        } else if (err.status === 409) {
          setErrorVariant("used");
        } else if (err.status === 401) {
          setFormError("Please sign in to accept this invitation.");
        } else {
          setFormError(
            err.message || "Could not accept the invitation. Please try again.",
          );
        }
      } else {
        setFormError("Network error. Please try again.");
      }
      setSubmitting(false);
    }
  }

  if (errorVariant) {
    return <InviteErrorState variant={errorVariant} />;
  }

  return (
    <div className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        You have been invited
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {tripName}
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">
          {inviterName}
        </span>{" "}
        invited you to collaborate on this trip.
      </p>

      <dl className="mt-5 grid gap-3 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-zinc-500">Role</dt>
          <dd>
            <span className="inline-flex items-center rounded-full border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:text-zinc-200">
              {roleLabel(role)}
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-zinc-500">Expires</dt>
          <dd className="text-zinc-800 dark:text-zinc-200">
            {formatExpiry(expiresAt)}
          </dd>
        </div>
      </dl>

      {formError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {formError}
        </div>
      )}

      <button
        type="button"
        onClick={onAccept}
        disabled={submitting}
        className={`${primaryButtonClass} w-full mt-6`}
      >
        {submitting ? "Accepting…" : "Accept invitation"}
      </button>
    </div>
  );
}
