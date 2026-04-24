import type { ReactNode } from "react";
import { AppHeader } from "@/components/app/AppHeader";

// Note: `user` is guaranteed by middleware (see app/src/middleware.ts, owned by
// [backend-engineer]). We still render defensively if email isn't available.
// A future iteration can read the session email server-side via the backend's
// `getSessionUser()` helper.
export default function TripsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <div className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {children}
      </div>
    </div>
  );
}
