/**
 * B-033 — Backend behavior: server-side `title` resolution from
 * `places.name` when client omits `title` and supplies `place_id`.
 *
 * Verifies:
 *   - Non-transport POST without `title` but WITH `place_id` resolves the
 *     title from the cached places row and inserts that as `title`.
 *   - Non-transport POST without `title` and WITHOUT `place_id` → 400.
 *   - Non-transport POST WITH explicit `title` still uses the client title
 *     (regression — existing callers must keep working).
 *   - Resolved title is bounded to 200 chars (defensive).
 *   - `source_card_id` is never set on inserts from this route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  FIXED_USER_ID,
  FIXED_TRIP_ID,
  FIXED_DAY_ID,
} from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async () => ({ ok: true, role: 'editor' }),
}));

const FIXED_PLACE_ID = '00000000-0000-4000-8000-000000000099';

interface CapturedInsert {
  table: string;
  payload: Record<string, unknown>;
}
const captured: CapturedInsert[] = [];
let cachedPlaceName: string | null = 'Sushi Saito';

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = async () => ({ data: [], error: null, count: 0 });
  chain.maybeSingle = async () => {
    if (table === 'trip_days') {
      return { data: { id: FIXED_DAY_ID }, error: null };
    }
    if (table === 'places') {
      return cachedPlaceName === null
        ? { data: null, error: null }
        : { data: { name: cachedPlaceName }, error: null };
    }
    return { data: null, error: null };
  };
  chain.insert = (payload: Record<string, unknown>) => {
    captured.push({ table, payload });
    return {
      select: () => ({
        single: async () => ({
          data: {
            id: '11111111-1111-4111-8111-111111111111',
            trip_id: FIXED_TRIP_ID,
            day_id: FIXED_DAY_ID,
            type: 'activity',
            title: 'mock',
            start_time: null,
            end_time: null,
            external_url: null,
            cost: null,
            currency: null,
            notes: null,
            place_id: null,
            created_by: FIXED_USER_ID,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            ...payload,
          },
          error: null,
        }),
      }),
    };
  };
  return chain;
}

const FRESH_SESSION = {
  user: { id: FIXED_USER_ID },
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }),
      getSession: async () => ({ data: { session: FRESH_SESSION }, error: null }),
      refreshSession: async () => ({ data: { session: FRESH_SESSION }, error: null }),
    },
    from: (t: string) => makeChain(t),
  }),
}));

import { POST } from '@/app/api/trips/[id]/items/route';

const ctx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };

function mkPost(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/trips/${FIXED_TRIP_ID}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  captured.length = 0;
  cachedPlaceName = 'Sushi Saito';
});

describe('POST /api/trips/[id]/items — B-033 title resolution', () => {
  it('resolves title from places.name when title is omitted and place_id is given', async () => {
    const res = await POST(
      mkPost({
        day_id: FIXED_DAY_ID,
        type: 'meal',
        place_id: FIXED_PLACE_ID,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    const insert = captured.find((c) => c.table === 'itinerary_items');
    expect(insert).toBeDefined();
    expect(insert?.payload.title).toBe('Sushi Saito');
    expect(insert?.payload.place_id).toBe(FIXED_PLACE_ID);
    // B-033 — source_card_id is never set by this code path.
    expect('source_card_id' in (insert?.payload ?? {})).toBe(false);
  });

  it('rejects with 400 when title is omitted AND no place_id is provided', async () => {
    const res = await POST(
      mkPost({ day_id: FIXED_DAY_ID, type: 'activity' }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when place_id resolves to no cached places row', async () => {
    cachedPlaceName = null;
    const res = await POST(
      mkPost({
        day_id: FIXED_DAY_ID,
        type: 'activity',
        place_id: FIXED_PLACE_ID,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('R4 Sec-M-1: returns an identical 400 body for both title-missing branches (no enumeration of cached places)', async () => {
    // Branch A: no place_id supplied at all.
    const resNoPlace = await POST(
      mkPost({ day_id: FIXED_DAY_ID, type: 'activity' }),
      ctx,
    );
    // Branch B: place_id supplied but no matching cached row.
    cachedPlaceName = null;
    const resMissingPlace = await POST(
      mkPost({
        day_id: FIXED_DAY_ID,
        type: 'activity',
        place_id: FIXED_PLACE_ID,
      }),
      ctx,
    );
    expect(resNoPlace.status).toBe(400);
    expect(resMissingPlace.status).toBe(400);
    const bodyA = (await resNoPlace.json()) as unknown;
    const bodyB = (await resMissingPlace.json()) as unknown;
    expect(bodyA).toEqual(bodyB);
  });

  it('keeps the explicit client-supplied title intact (no override) — regression', async () => {
    const res = await POST(
      mkPost({
        day_id: FIXED_DAY_ID,
        type: 'activity',
        title: 'Custom title',
        place_id: FIXED_PLACE_ID,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    const insert = captured.find((c) => c.table === 'itinerary_items');
    expect(insert?.payload.title).toBe('Custom title');
  });

  it('caps a long resolved title at 200 chars', async () => {
    cachedPlaceName = 'x'.repeat(500);
    const res = await POST(
      mkPost({
        day_id: FIXED_DAY_ID,
        type: 'activity',
        place_id: FIXED_PLACE_ID,
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    const insert = captured.find((c) => c.table === 'itinerary_items');
    expect(String(insert?.payload.title).length).toBe(200);
  });
});
