"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, apiFetch } from "@/lib/utils/api-client";
import { validatePassword } from "@/lib/utils/validation";
import {
  FormField,
  inputClass,
  primaryButtonClass,
} from "@/components/ui/FormField";

interface SignupForInviteFormProps {
  token: string;
  email: string;
}

interface FieldErrors {
  password?: string;
  confirm_password?: string;
}

/**
 * Invitation-gated sign-up form (B-019). Email is pre-filled and read-only
 * from the validated invitation; submitting POSTs to /api/auth/signup with
 * the invite_token. On 200 we sign the new user in via /api/auth/signin and
 * land them on /trips so they can open their newly-joined trip.
 */
export function SignupForInviteForm({ token, email }: SignupForInviteFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function mapErrorToMessage(err: ApiClientError): {
    field?: keyof FieldErrors;
    message: string;
  } {
    switch (err.code) {
      case "invite_required":
      case "invite_invalid":
        return {
          message:
            "This invitation link is no longer valid. Ask the trip owner for a new one.",
        };
      case "invite_expired":
        return {
          message: "This invitation has expired. Ask the trip owner to resend it.",
        };
      case "invite_used":
        return {
          message:
            "This invitation has already been used. Sign in with your existing account.",
        };
      case "invite_revoked":
        return {
          message: "This invitation was revoked by the trip owner.",
        };
      case "invite_email_mismatch":
        return {
          message: "This invitation was sent to a different email.",
        };
      case "rate_limit_exceeded":
        return {
          message: "Too many sign-up attempts. Try again later.",
        };
      case "validation_error": {
        // Surface server-side field detail when present.
        const details = err.details;
        if (details && typeof details === "object") {
          const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
          if (fieldErrors && typeof fieldErrors === "object") {
            const fe = fieldErrors as Record<string, unknown>;
            const passwordMsg = Array.isArray(fe.password)
              ? String(fe.password[0])
              : null;
            if (passwordMsg) return { field: "password", message: passwordMsg };
            const confirmMsg = Array.isArray(fe.confirm_password)
              ? String(fe.confirm_password[0])
              : null;
            if (confirmMsg)
              return { field: "confirm_password", message: confirmMsg };
          }
        }
        return { message: "Please check your details and try again." };
      }
      default:
        return {
          message: "We could not create your account. Please try again.",
        };
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const fieldErrors: FieldErrors = {};
    const strength = validatePassword(password);
    if (!strength.ok) {
      fieldErrors.password = `Password must include: ${strength.reasons.join(", ")}.`;
    }
    if (confirmPassword !== password) {
      fieldErrors.confirm_password = "Passwords do not match.";
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await apiFetch<{ ok: true }>("/api/auth/signup", {
        method: "POST",
        body: {
          email,
          password,
          confirm_password: confirmPassword,
          invite_token: token,
        },
      });
      // Server creates the user with email_confirm:true but does not
      // establish a session. Sign in to set the auth cookie, then refresh.
      try {
        await apiFetch<{ user_id: string }>("/api/auth/signin", {
          method: "POST",
          body: { email, password },
        });
        router.replace("/trips");
        router.refresh();
      } catch {
        // Account was created but sign-in failed (transient). Send the user
        // to /sign-in where they can complete the flow with the same
        // credentials.
        router.replace("/sign-in");
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        const mapped = mapErrorToMessage(err);
        if (mapped.field) {
          setErrors({ [mapped.field]: mapped.message });
        } else {
          setFormError(mapped.message);
        }
      } else {
        setFormError("Network error. Please try again.");
      }
      setSubmitting(false);
    }
  }

  if (submitting) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Creating your account"
        className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-3"
      >
        <div className="h-4 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-10 rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-10 rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-10 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <p className="sr-only">Creating your account…</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Create account from invitation"
      className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
    >
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
        Create your account
      </h2>

      {formError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {formError}
        </div>
      )}

      <FormField id="invite-email" label="Email">
        <input
          id="invite-email"
          name="email"
          type="email"
          value={email}
          readOnly
          aria-readonly="true"
          autoComplete="email"
          className={`${inputClass} bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400`}
        />
      </FormField>

      <FormField
        id="invite-password"
        label="Password"
        required
        error={errors.password}
        hint="At least 12 characters, with upper, lower, and a digit."
      >
        <input
          id="invite-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          aria-invalid={errors.password ? "true" : undefined}
        />
      </FormField>

      <FormField
        id="invite-confirm-password"
        label="Confirm password"
        required
        error={errors.confirm_password}
      >
        <input
          id="invite-confirm-password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
          aria-invalid={errors.confirm_password ? "true" : undefined}
        />
      </FormField>

      <input type="hidden" name="invite_token" value={token} readOnly />

      <button
        type="submit"
        disabled={submitting}
        className={`${primaryButtonClass} w-full`}
      >
        Create account &amp; accept invitation
      </button>
    </form>
  );
}
