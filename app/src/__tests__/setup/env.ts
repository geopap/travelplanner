/**
 * Test environment — populated before any modules load so that
 * `@/lib/supabase/*` and route handlers see valid values.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.NEXT_PUBLIC_SITE_URL ??= 'http://localhost:3000';
