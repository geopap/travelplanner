import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Creates a Supabase server client bound to a Next.js proxy/middleware
 * request + response cookie store. Refreshes the session cookie on every
 * request. Returns the client and the mutable NextResponse so the caller
 * can return it (preserving updated cookies).
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
