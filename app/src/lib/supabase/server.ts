import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Server-side Supabase client bound to Next.js cookies() for the current request.
 * Uses the anon key; RLS is the isolation boundary.
 *
 * Call inside route handlers, server components, and server actions.
 * Always create a fresh client per request — never share across requests.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env var',
    );
  }
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render path where cookies are read-only.
          // Proxy/middleware refreshes the session cookies, so this is safe to ignore.
        }
      },
    },
  });
}

export type RequireAuthResult = {
  user: User;
  supabase: SupabaseClient;
};

/**
 * Fetch the current authenticated user server-side.
 * Returns null if not authenticated — never throws.
 */
export async function getSessionUser(): Promise<
  { user: User | null; supabase: SupabaseClient }
> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return { user: data.user, supabase };
}

/**
 * Defense-in-depth auth guard. Route handlers should call this first and
 * return the `unauthorizedResponse()` on failure (proxy already intercepts
 * protected matchers, but routes still verify).
 */
export async function requireAuth(): Promise<RequireAuthResult | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { user: data.user, supabase };
}
