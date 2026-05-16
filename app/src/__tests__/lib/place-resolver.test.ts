/**
 * B-023 R5 — Unit tests for the shared `resolveGooglePlaceId` helper.
 *
 * The helper is exercised end-to-end by the accommodations route tests, but
 * those go through the full POST/PATCH chain. This file pins down the
 * three contract outcomes (`ok`, `not_cached`, `lookup_error`) in isolation so
 * a regression in the resolver itself is caught even if the routes change.
 *
 * No DB / network — a hand-rolled SupabaseClient stub returns the desired
 * `.maybeSingle()` payload for each scenario.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGooglePlaceId } from '@/lib/supabase/place-resolver';

interface MaybeSingleResult {
  data: { id: string } | null;
  error: { message: string } | null;
}

function makeClient(result: MaybeSingleResult): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => result;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub: any = { from: () => chain };
  return stub as SupabaseClient;
}

const VALID_GPID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const PLACES_ID = '00000000-0000-4000-8000-0000000000aa';

describe('resolveGooglePlaceId (B-023)', () => {
  it('returns ok + internal uuid on cache hit', async () => {
    const sb = makeClient({ data: { id: PLACES_ID }, error: null });
    const out = await resolveGooglePlaceId(sb, VALID_GPID);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.placeId).toBe(PLACES_ID);
  });

  it('returns not_cached when the place row is missing', async () => {
    const sb = makeClient({ data: null, error: null });
    const out = await resolveGooglePlaceId(sb, VALID_GPID);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('not_cached');
  });

  it('returns lookup_error when the underlying query errors', async () => {
    const sb = makeClient({
      data: null,
      error: { message: 'connection terminated' },
    });
    const out = await resolveGooglePlaceId(sb, VALID_GPID);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('lookup_error');
  });
});
