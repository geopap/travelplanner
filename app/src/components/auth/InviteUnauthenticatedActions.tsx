"use client";

import Link from "next/link";
import { useState } from "react";
import {
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui/FormField";
import { SignupForInviteForm } from "@/components/auth/SignupForInviteForm";

interface InviteUnauthenticatedActionsProps {
  token: string;
  email: string | null;
  next: string;
}

/**
 * Renders the unauthenticated CTA pair on /invite/[token]:
 * - "Sign in to accept" (existing flow, B-012)
 * - "Create account" toggle that opens an inline SignupForInviteForm (B-019)
 *
 * The Create account button is hidden when the invitation lookup did not
 * surface an email (defence-in-depth: we only allow read-only pre-fill).
 */
export function InviteUnauthenticatedActions({
  token,
  email,
  next,
}: InviteUnauthenticatedActionsProps) {
  const [showSignup, setShowSignup] = useState(false);

  return (
    <>
      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <Link
          href={`/sign-in?redirect=${encodeURIComponent(next)}`}
          className={`${primaryButtonClass} w-full sm:w-auto`}
        >
          Sign in to accept
        </Link>
        {email && (
          <button
            type="button"
            onClick={() => setShowSignup((v) => !v)}
            aria-expanded={showSignup}
            aria-controls="invite-signup-panel"
            className={`${secondaryButtonClass} w-full sm:w-auto`}
          >
            {showSignup ? "Hide create account" : "Create account"}
          </button>
        )}
      </div>
      {showSignup && email && (
        <div id="invite-signup-panel">
          <SignupForInviteForm token={token} email={email} />
        </div>
      )}
    </>
  );
}
