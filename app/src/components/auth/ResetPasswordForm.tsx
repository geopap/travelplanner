"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { validatePassword } from "@/lib/utils/validation";
import {
  FormField,
  inputClass,
  primaryButtonClass,
} from "@/components/ui/FormField";

/**
 * Complete-password-reset form.
 *
 * Supabase delivers the reset email as a link to NEXT_PUBLIC_SITE_URL/reset-password
 * containing an access_token in the URL hash. On mount we pull the hash and pass
 * it to /api/auth/password-reset/complete so the backend can verify and set the
 * new password, then invalidate other sessions.
 */
function readRecoveryTokenFromHash(): {
  token: string | null;
  error: string | null;
} {
  if (typeof window === "undefined") {
    return { token: null, error: null };
  }
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  const type = params.get("type");
  if (token && (type === "recovery" || type === null)) {
    // Scrub the token from history so it doesn't leak to referrers.
    window.history.replaceState(null, "", window.location.pathname);
    return { token, error: null };
  }
  return {
    token: null,
    error: "This reset link is invalid or has expired. Request a new one.",
  };
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [{ token: recoveryToken, error: tokenError }] = useState(
    readRecoveryTokenFromHash,
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!recoveryToken) return;
    setFormError(null);

    const fieldErrors: Record<string, string> = {};
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
      await apiFetch<{ ok: true }>("/api/auth/password-reset/complete", {
        method: "POST",
        body: {
          access_token: recoveryToken,
          password,
          confirm_password: confirmPassword,
        },
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 429) {
          setFormError("Too many attempts. Please try again later.");
        } else if (err.status === 401 || err.status === 400) {
          setFormError(
            "This reset link is invalid or has expired. Request a new one.",
          );
        } else {
          setFormError("Something went wrong. Please try again.");
        }
      } else {
        setFormError("Network error. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (tokenError) {
    return (
      <div
        role="alert"
        className="w-full max-w-md mx-auto rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-6 text-center"
      >
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-200">
          Link invalid or expired
        </h2>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">
          {tokenError}
        </p>
        <Link
          href="/forgot-password"
          className={`${primaryButtonClass} mt-5`}
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Password updated
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Your password has been updated and other sessions signed out.
        </p>
        <button
          type="button"
          onClick={() => router.replace("/sign-in")}
          className={`${primaryButtonClass} mt-6`}
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Set a new password
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Choose a strong password you have not used before.
      </p>

      {formError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
        >
          {formError}
        </div>
      )}

      <div className="mt-6 space-y-4">
        <FormField
          id="password"
          label="New password"
          required
          error={errors.password}
          hint="At least 12 characters, with upper, lower, and a digit."
        >
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </FormField>

        <FormField
          id="confirm_password"
          label="Confirm new password"
          required
          error={errors.confirm_password}
        >
          <input
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />
        </FormField>
      </div>

      <button
        type="submit"
        disabled={submitting || !recoveryToken}
        className={`${primaryButtonClass} w-full mt-6`}
      >
        {submitting ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
