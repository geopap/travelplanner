import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata = { title: "Sign in · TravelPlanner" };

interface SignInPageProps {
  searchParams: Promise<{ notice?: string | string[] }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const noticeRaw = Array.isArray(params.notice) ? params.notice[0] : params.notice;
  const showInviteOnly = noticeRaw === "invite_only";

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      {showInviteOnly && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 p-3 text-sm text-amber-800 dark:text-amber-200"
        >
          Sign-up is invitation-only. If you were invited, open your invitation
          link to create an account.
        </div>
      )}
      <Suspense fallback={null}>
        <AuthForm mode="signin" />
      </Suspense>
    </div>
  );
}
