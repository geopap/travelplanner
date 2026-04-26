"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import {
  isSafeRedirectPath,
  validateEmail,
  validatePassword,
} from "@/lib/utils/validation";
import {
  FormField,
  inputClass,
  primaryButtonClass,
} from "@/components/ui/FormField";

export type AuthFormMode = "signin" | "signup" | "forgot";

interface AuthFormProps {
  mode: AuthFormMode;
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect");
  const safeRedirect = isSafeRedirectPath(redirectParam) ? redirectParam : null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const fieldErrors: Record<string, string> = {};

    if (!validateEmail(email)) {
      fieldErrors.email = "Enter a valid email address.";
    }

    if (mode !== "forgot") {
      if (password.length === 0) {
        fieldErrors.password = "Password is required.";
      } else if (mode === "signup") {
        const strength = validatePassword(password);
        if (!strength.ok) {
          fieldErrors.password = `Password must include: ${strength.reasons.join(", ")}.`;
        }
        if (confirmPassword !== password) {
          fieldErrors.confirm_password = "Passwords do not match.";
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await apiFetch<{ user_id: string }>("/api/auth/signup", {
          method: "POST",
          body: {
            email,
            password,
            confirm_password: confirmPassword,
          },
        });
        setSubmitted(true);
      } else if (mode === "signin") {
        await apiFetch<{ user_id: string }>("/api/auth/signin", {
          method: "POST",
          body: { email, password },
        });
        router.replace(safeRedirect ?? "/trips");
        router.refresh();
      } else {
        await apiFetch<{ ok: true }>("/api/auth/password-reset", {
          method: "POST",
          body: { email },
        });
        setSubmitted(true);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 429) {
          setFormError("Too many attempts. Please try again later.");
        } else if (mode === "signin") {
          setFormError("Email or password incorrect.");
        } else if (mode === "signup") {
          setFormError(
            "We could not create your account. Please check your details and try again.",
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

  if (submitted && mode === "signup") {
    return (
      <SuccessPanel
        title="Check your email"
        message="We sent a confirmation link to your inbox. Click it to activate your account, then sign in."
        footer={
          <Link
            href="/sign-in"
            className="text-sm font-medium underline underline-offset-4"
          >
            Back to sign in
          </Link>
        }
      />
    );
  }

  if (submitted && mode === "forgot") {
    return (
      <SuccessPanel
        title="Check your email"
        message="If an account exists for that address, we sent a password-reset link. The link expires in 1 hour."
        footer={
          <Link
            href="/sign-in"
            className="text-sm font-medium underline underline-offset-4"
          >
            Back to sign in
          </Link>
        }
      />
    );
  }

  const title =
    mode === "signin"
      ? "Sign in"
      : mode === "signup"
      ? "Create your account"
      : "Reset your password";

  const subtitle =
    mode === "signin"
      ? "Welcome back."
      : mode === "signup"
      ? "Plan trips, together or solo."
      : "Enter your email and we'll send a reset link.";

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {subtitle}
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
          id="email"
          label="Email"
          required
          error={errors.email}
        >
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </FormField>

        {mode !== "forgot" && (
          <FormField
            id="password"
            label="Password"
            required
            error={errors.password}
            hint={
              mode === "signup"
                ? "At least 12 characters, with upper, lower, and a digit."
                : undefined
            }
          >
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </FormField>
        )}

        {mode === "signup" && (
          <FormField
            id="confirm_password"
            label="Confirm password"
            required
            error={errors.confirm_password}
          >
            <input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </FormField>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className={`${primaryButtonClass} w-full mt-6`}
      >
        {submitting
          ? "Please wait…"
          : mode === "signin"
          ? "Sign in"
          : mode === "signup"
          ? "Create account"
          : "Send reset link"}
      </button>

      <div className="mt-6 text-sm text-zinc-600 dark:text-zinc-400 space-y-2 text-center">
        {mode === "signin" && (
          <>
            <div>
              <Link
                href="/forgot-password"
                className="font-medium underline underline-offset-4"
              >
                Forgot your password?
              </Link>
            </div>
            <div className="text-zinc-500 dark:text-zinc-500">
              New here? Sign-up is invitation-only — open your invitation link
              to create an account.
            </div>
          </>
        )}
        {mode === "signup" && (
          <div>
            Already have an account?{" "}
            <Link
              href="/sign-in"
              className="font-medium underline underline-offset-4"
            >
              Sign in
            </Link>
          </div>
        )}
        {mode === "forgot" && (
          <div>
            Remembered it?{" "}
            <Link
              href="/sign-in"
              className="font-medium underline underline-offset-4"
            >
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </form>
  );
}

function SuccessPanel({
  title,
  message,
  footer,
}: {
  title: string;
  message: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-md mx-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center shadow-sm">
      <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-6 h-6 text-emerald-700 dark:text-emerald-300"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h2 className="mt-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {message}
      </p>
      {footer && <div className="mt-6">{footer}</div>}
    </div>
  );
}
