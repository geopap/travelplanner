import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Creates a Supabase server client bound to a Next.js proxy/middleware
 * request + response cookie store. Refreshes the session cookie on every
 * request. Returns the client and the mutable NextResponse so the caller
 * can return it (preserving updated cookies).
 *
 * B-045 audit (2026-05-16): the `setAll` block below matches the canonical
 * `@supabase/ssr` Next.js 16 pattern verbatim — mutate `request.cookies` so
 * the rebuilt `NextResponse.next({ request })` re-emits them on the inbound
 * request object the route handler observes, then mirror onto the outbound
 * response so the browser persists the refresh. This is correct; the 1h-idle
 * RLS-violation symptom comes from the documented refresh-token race on
 * concurrent expired-cookie requests (see ssr README) plus the absence of a
 * proactive freshness check inside route handlers, NOT from a cookie-write
 * bug here. Remediation: `requireFreshSession()` guard in mutating routes,
 * plus a 42501 → `session_expired` catch (defense-in-depth).
 */
export function createSupabaseMiddlewareClient(
  request: NextRequest,
): { supabase: SupabaseClient; response: NextResponse } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env var',
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mirror refreshed cookies into BOTH the inbound request store (so
        // anything reading `request.cookies` after `getUser()` sees them)
        // and the rebuilt outbound response (so the browser persists them).
        // This is the canonical @supabase/ssr Next.js 16 pattern.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return { supabase, response };
}

export async function getMiddlewareUser(
  supabase: SupabaseClient,
): Promise<User | null> {
  const { data } = await supabase.auth.getUser();
  return data.user;
}
