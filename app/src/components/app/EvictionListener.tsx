"use client";

// B-013 AC-9 — listens for trip-eviction events fired by the API client
// wrapper and shows a brief toast before redirecting to /trips. Mounted
// once in the root layout so it works on every page (including pages
// that poll trip-scoped endpoints in the background).

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { EVICTION_EVENT } from "@/lib/utils/eviction";

const TOAST_VISIBLE_MS = 3500;

export function EvictionListener() {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onEvict() {
      // If we are already on /trips (the destination), only show the toast;
      // no redirect necessary. Avoids a noisy navigation churn.
      const onTripsRoot = pathname === "/trips";
      setVisible(true);
      if (!onTripsRoot) {
        router.replace("/trips");
      } else {
        // Force list refresh so the just-removed trip disappears.
        router.refresh();
      }
      window.setTimeout(() => setVisible(false), TOAST_VISIBLE_MS);
    }
    window.addEventListener(EVICTION_EVENT, onEvict);
    return () => window.removeEventListener(EVICTION_EVENT, onEvict);
  }, [router, pathname]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[min(92vw,28rem)] rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/80 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 shadow-lg"
    >
      You no longer have access to this trip.
    </div>
  );
}
