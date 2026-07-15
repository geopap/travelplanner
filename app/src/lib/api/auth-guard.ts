import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Grace window used when deciding whether a session is "fresh enough" to
 * survive an RLS-checked mutation. 30s covers normal request latency plus
 * a small clock-skew margin without inviting unnecessary refresh-token
 * spend. Canonical constant — never hardcode this elsewhere.
 */
export const SESSION_EXPIRY_GRACE_MS = 30_000;

export type RequireFreshSessionResult =
  | { ok: true; user: User }
  | { ok: false };

/**
 * B-045 — Defense-in-depth guard against the 1h-idle-tab failure mode where
 * `@supabase/ssr` keeps reusing an access_token whose `exp` has already
 * passed. PostgREST will still decode the claims (so `auth.uid()` looks
 * correct on SELECTs) but reject WITH-CHECK on INSERT/UPDATE with a 42501
 * RLS violation, surfacing as a generic 500.
 *
 * Call BEFORE the first mutation in every protected mutating route, passing
 * the user already verified via `supabase.auth.getUser()` (the guard does
 * not re-verify — avoid a second GoTrue round-trip per request). If the
 * current session is within the 30s grace window of expiry (or already
 * expired), proactively refresh exactly once. Returns `{ ok: false }` when
 * refresh fails or yields a still-stale session — callers should respond
 * with `sessionExpired()`.
 */
export async function requireFreshSession(
  supabase: SupabaseClient,
  user: User,
): Promise<RequireFreshSessionResult> {
  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) return { ok: false };
    const session = sessionData.session;
    if (!session) {
      // Known @supabase/ssr quirk: a verified user with no local session
      // object on the first server-side call after a fresh sign-in.
      // Proceed — the 42501 catch in the route is the safety net for the
      // actually-stale-token case.
      return { ok: true, user };
    }

    const expiresAt = session.expires_at;
    const nowMs = Date.now();
    const freshEnough =
      typeof expiresAt === 'number' && expiresAt * 1000 >= nowMs + SESSION_EXPIRY_GRACE_MS;

    if (freshEnough) {
      return { ok: true, user: session.user };
    }

    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr) return { ok: false };
    const refreshedSession = refreshed.session;
    if (!refreshedSession) return { ok: false };

    const refreshedExp = refreshedSession.expires_at;
    const refreshedFresh =
      typeof refreshedExp === 'number' &&
      refreshedExp * 1000 >= Date.now() + SESSION_EXPIRY_GRACE_MS;
    if (!refreshedFresh) return { ok: false };

    return { ok: true, user: refreshedSession.user };
  } catch {
    return { ok: false };
  }
}

/**
 * PostgREST RLS WITH-CHECK violation code. Routes use this to detect the
 * residual case where the guard let a write through but the access_token
 * the underlying client still holds was stale — promote 500 → 401 with the
 * `session_expired` code so the client can prompt re-auth.
 */
export const POSTGRES_RLS_VIOLATION_CODE = '42501';
