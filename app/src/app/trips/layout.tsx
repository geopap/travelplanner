import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/AppHeader";
import { getSessionUser } from "@/lib/supabase/server";

// `user` is guaranteed by middleware (see app/src/middleware.ts, owned by
// [backend-engineer]); we read the session email server-side so the header
// can show it and link to profile settings. Rendering stays defensive if
// the email is unavailable.
//
// Note: the content div carries id="main" (skip-link target from the root
// layout). It deliberately stays a <div> — sub-pages render their own
// <main> landmark inside it.
export default async function TripsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await getSessionUser();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader userEmail={user?.email ?? null} />
      <div
        id="main"
        className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10"
      >
        {children}
      </div>
    </div>
  );
}
