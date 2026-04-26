"use client";

import { useState, type FormEvent } from "react";
import { ApiClientError } from "@/lib/utils/api-client";
import { validateEmail } from "@/lib/utils/validation";
import {
  FormField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
} from "@/components/ui/FormField";
import {
  createInvitation,
  type CreateInvitationResponse,
} from "@/lib/hooks/useInvitations";

type InviteRole = "editor" | "viewer";

interface InvitationFormProps {
  tripId: string;
  onCreated?: () => void;
}

export function InvitationForm({ tripId, onCreated }: InvitationFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<
    CreateInvitationResponse["invitation"] | null
  >(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    const fieldErrors: Record<string, string> = {};
    const trimmed = email.trim();
    if (!validateEmail(trimmed)) {
      fieldErrors.email = "Enter a valid email address.";
    }
    if (role !== "editor" && role !== "viewer") {
      fieldErrors.role = "Choose a role.";
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const res = await createInvitation(tripId, { email: trimmed, role });
      setSuccess(res.invitation);
      setEmail("");
      setRole("editor");
      onCreated?.();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 409 && err.code === "invitation_pending_exists") {
          setFormError(
            "There is already a pending invitation for that email on this trip.",
          );
        } else if (err.status === 429) {
          setFormError("Too many invitations sent. Please try again later.");
        } else if (err.status === 400) {
          setFormError(err.message || "Please check the details and try again.");
        } else if (err.status === 403) {
          setFormError("Only the trip owner can invite members.");
        } else {
          setFormError(err.message || "Could not create the invitation.");
        }
      } else {
        setFormError("Network error. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onCopy() {
    if (!success?.invite_url) return;
    try {
      await navigator.clipboard.writeText(success.invite_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 sm:p-6">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        Invite a partner
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        They will get a link valid for 48 hours.
      </p>

      {formError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {formError}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          <p className="font-medium">
            Invitation sent to {success.email}.
          </p>
          <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
            <code
              className="flex-1 truncate rounded border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-zinc-950 px-2 py-1 text-xs text-zinc-800 dark:text-zinc-200"
              title={success.invite_url}
            >
              {success.invite_url}
            </code>
            <button
              type="button"
              onClick={onCopy}
              className={secondaryButtonClass}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <FormField
          id="invite-email"
          label="Email"
          required
          error={errors.email}
        >
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            className={inputClass}
            placeholder="partner@example.com"
          />
        </FormField>

        <FormField
          id="invite-role"
          label="Role"
          required
          error={errors.role}
        >
          <select
            id="invite-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as InviteRole)}
            aria-invalid={errors.role ? true : undefined}
            className={selectClass}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </FormField>

        <button
          type="submit"
          disabled={submitting}
          className={primaryButtonClass}
        >
          {submitting ? "Sending…" : "Send invitation"}
        </button>
      </form>
    </section>
  );
}
