// B-045 — Client-side fetch wrapper that detects `session_expired` 401
// responses from our API and redirects the user to the sign-in page,
// carrying the current pathname + search in the `redirect` query param
// (matches the param AuthForm reads at app/src/components/auth/AuthForm.tsx:27).
//
// This wrapper returns the raw Response so callers can continue to handle
// it however they want (read JSON, check status, etc.) — only the
// session-expired case is intercepted.

/** Sentinel thrown after a session_expired redirect is initiated so callers stop. */
export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired — redirecting to sign-in");
    this.name = "SessionExpiredError";
  }
}

interface SessionExpiredEnvelope {
  error: { code: "session_expired" };
}

function isSessionExpiredEnvelope(value: unknown): value is SessionExpiredEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const err = (value as { error?: unknown }).error;
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "session_expired";
}

/**
 * Drop-in replacement for `fetch()` on the client. If the response is a 401
 * with body `{ error: { code: 'session_expired' } }`, the user is redirected
 * to `/sign-in?redirect=<current path+search>&notice=session_expired` and a `SessionExpiredError`
 * is thrown so the caller short-circuits. All other responses are returned
 * untouched.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  // SSR safety: if somehow invoked server-side, never touch window.
  if (typeof window === "undefined") {
    return response;
  }

  if (response.status !== 401) {
    return response;
  }

  // Peek at the body via clone() so the original response remains
  // unconsumed for callers that want to read it.
  let body: unknown = null;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  if (!isSessionExpiredEnvelope(body)) {
    return response;
  }

  const here = window.location.pathname + window.location.search;
  const redirectTo = `/sign-in?redirect=${encodeURIComponent(here)}&notice=session_expired`;
  window.location.assign(redirectTo);
  throw new SessionExpiredError();
}
