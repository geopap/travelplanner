import { describe, it, expect } from 'vitest';
import { checkTripAccess } from '@/lib/trip-access';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a minimal supabase-client stub that fakes the trip_members
 * read chain: .from().select().eq().eq().eq().maybeSingle().
 */
function fakeSupabase(
  result: { data: { role: string; status: string } | null; error: unknown },
): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return {
    from: () => chain,
  } as unknown as SupabaseClient;
}

const TRIP = '11111111-2222-4333-8444-555555555555';
const USER = '22222222-3333-4444-8555-666666666666';

describe('checkTripAccess', () => {
  it('owner satisfies viewer requirement', async () => {
    const sb = fakeSupabase({ data: { role: 'owner', status: 'accepted' }, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'viewer');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.role).toBe('owner');
  });

  it('editor satisfies viewer requirement', async () => {
    const sb = fakeSupabase({ data: { role: 'editor', status: 'accepted' }, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'viewer');
    expect(r.ok).toBe(true);
  });

  it('viewer satisfies viewer requirement', async () => {
    const sb = fakeSupabase({ data: { role: 'viewer', status: 'accepted' }, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'viewer');
    expect(r.ok).toBe(true);
  });

  it('viewer does NOT satisfy editor', async () => {
    const sb = fakeSupabase({ data: { role: 'viewer', status: 'accepted' }, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'editor');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('forbidden');
  });

  it('editor does NOT satisfy owner', async () => {
    const sb = fakeSupabase({ data: { role: 'editor', status: 'accepted' }, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'owner');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('forbidden');
  });

  it('owner satisfies owner', async () => {
    const sb = fakeSupabase({ data: { role: 'owner', status: 'accepted' }, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'owner');
    expect(r.ok).toBe(true);
  });

  it('no membership returns not_found', async () => {
    const sb = fakeSupabase({ data: null, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'viewer');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('DB error returns not_found (no leak)', async () => {
    const sb = fakeSupabase({ data: null, error: new Error('boom') });
    const r = await checkTripAccess(sb, TRIP, USER, 'viewer');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });

  it('unknown role value fails closed as forbidden', async () => {
    const sb = fakeSupabase({ data: { role: 'superuser', status: 'accepted' }, error: null });
    const r = await checkTripAccess(sb, TRIP, USER, 'viewer');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('forbidden');
  });
});
