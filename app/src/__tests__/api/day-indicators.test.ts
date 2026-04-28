/**
 * B-008 — day-indicators endpoint tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

let role: 'viewer' | 'editor' | 'owner' | 'none' = 'viewer';
vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async (
    _sb: unknown,
    _trip: string,
    _user: string,
    required: 'viewer' | 'editor' | 'owner',
  ) => {
    if (role === 'none') return { ok: false, reason: 'not_found' };
    const rank: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[required])
      return { ok: false, reason: 'forbidden' };
    return { ok: true, role };
  },
}));

interface State {
  rows: Array<Record<string, unknown>>;
  limitArg: number | null;
}
const state: State = { rows: [], limitArg: null };

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }),
    },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.limit = (n: number) => {
        state.limitArg = n;
        return Promise.resolve({ data: state.rows, error: null });
      };
      return chain;
    },
  }),
}));

import { GET } from '@/app/api/trips/[id]/day-indicators/route';

const ctx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };

beforeEach(() => {
  role = 'viewer';
  state.rows = [];
  state.limitArg = null;
});

function mkRow(over: Record<string, unknown>) {
  return {
    trip_id: FIXED_TRIP_ID,
    trip_day_id: '00000000-0000-4000-8000-000000000020',
    day_date: '2026-05-01',
    accommodation_id: '00000000-0000-4000-8000-000000000a01',
    hotel_name: 'h',
    place_id: null,
    indicator_type: 'check_in',
    ...over,
  };
}

describe('GET /api/trips/[id]/day-indicators', () => {
  it('viewer can read', async () => {
    state.rows = [mkRow({})];
    const res = await GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/day-indicators`,
      ),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { indicators: unknown[] };
    expect(body.indicators).toHaveLength(1);
  });

  it('non-member 404', async () => {
    role = 'none';
    const res = await GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/day-indicators`,
      ),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('honors defensive 1000-row cap (regression)', async () => {
    state.rows = [mkRow({})];
    await GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/day-indicators`,
      ),
      ctx,
    );
    expect(state.limitArg).toBe(1000);
  });

  it('returns indicators with correct shape', async () => {
    state.rows = [
      mkRow({ indicator_type: 'check_in' }),
      mkRow({ indicator_type: 'in_stay' }),
      mkRow({ indicator_type: 'check_out' }),
      mkRow({ indicator_type: 'same_day' }),
    ];
    const res = await GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/day-indicators`,
      ),
      ctx,
    );
    const body = (await res.json()) as {
      indicators: Array<{ indicator_type: string }>;
    };
    expect(body.indicators.map((i) => i.indicator_type)).toEqual([
      'check_in',
      'in_stay',
      'check_out',
      'same_day',
    ]);
  });
});
