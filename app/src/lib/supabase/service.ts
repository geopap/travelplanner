import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Privileged server-only Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 *
 * WARNING: this client bypasses RLS. Every call must explicitly verify the
 * acting user's membership/role before touching trip-scoped rows. Use only
 * for:
 *  - audit log writes
 *  - operations that must cross the RLS boundary (e.g. read-modify-write
 *    flows during trip deletion, password reset completion, GDPR delete).
 *
 * MUST NEVER be imported from any client-bundled file.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env var',
    );
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
