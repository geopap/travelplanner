"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/utils/api-client";

export function AppHeader({ userEmail }: { userEmail?: string | null }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await apiFetch<void>("/api/auth/signout", { method: "POST" });
    } catch {
      // Even if the call fails, fall through and push to sign-in.
    } finally {
      router.replace("/sign-in");
      router.refresh();
    }
  }

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link
          href="/trips"
          className="font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          TravelPlanner
        </Link>
        <div className="flex items-center gap-3">
          {userEmail && (
            <span className="hidden sm:inline text-xs text-zinc-500">
              {userEmail}
            </span>
          )}
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="h-9 px-4 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}
