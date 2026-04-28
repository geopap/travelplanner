// B-013 — Active-session eviction signalling.
//
// When a trip-scoped API call returns 403 with code `not_a_member` (the
// owner removed us, or our membership was otherwise revoked mid-session),
// the API client wrapper dispatches an `EVICTION_EVENT` on the window.
// A small global listener mounted in the root layout shows a toast and
// redirects to /trips. Using a CustomEvent keeps the wrapper free of
// React/router dependencies and survives in non-React callers (tests,
// background polls).

export const EVICTION_EVENT = "travelplanner:trip-evicted" as const;

export interface EvictionDetail {
  /** The trip id we just lost access to (best-effort, parsed from path). */
  tripId: string;
  /** The path that triggered the eviction. */
  path: string;
}

/**
 * Returns the trip id if `path` is a trip-scoped API path
 * (`/api/trips/<id>/...`), excluding the `/api/trips` collection itself.
 */
export function parseTripScopedPath(path: string): string | null {
  // Strip query string + leading origin if present.
  let p = path;
  const qIdx = p.indexOf("?");
  if (qIdx !== -1) p = p.slice(0, qIdx);
  try {
    if (/^https?:\/\//.test(p)) {
      p = new URL(p).pathname;
    }
  } catch {
    return null;
  }
  // Match /api/trips/<id>/<rest>
  const match = /^\/api\/trips\/([^/]+)\/.+/.exec(p);
  return match ? match[1] : null;
}

/**
 * Dispatch the eviction event. No-op on the server.
 * Guarded against repeated firings during a flurry of failing parallel
 * calls — once per browser session is enough; the listener still re-fires
 * the toast if user navigates back, but consecutive 403s are coalesced.
 */
let lastDispatchAt = 0;
const DISPATCH_DEDUP_MS = 1500;

export function dispatchEviction(detail: EvictionDetail): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastDispatchAt < DISPATCH_DEDUP_MS) return;
  lastDispatchAt = now;
  window.dispatchEvent(
    new CustomEvent<EvictionDetail>(EVICTION_EVENT, { detail }),
  );
}
