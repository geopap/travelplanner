/**
 * B-008 — API tests for accommodations CRUD.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (p: Record<string, unknown>) => {
    auditCalls.push(p);
  },
}));

let role: 'viewer' | 'editor' | 'owner' | 'none' = 'editor';
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

const ACC_ID = '00000000-0000-4000-8000-000000000a01';
const PLACE_ID = '00000000-0000-4000-8000-000000000b01';

interface State {
  trip: { start_date: string; end_date: string } | null;
  placeExists: boolean;
  insertError: { message: string } | null;
  updateError: { message: string } | null;
  existing: Record<string, unknown> | null;
  fromCalls: Record<string, number>;
  capturedInsert: Record<string, unknown> | null;
  capturedUpdate: Record<string, unknown> | null;
}

const state: State = {
  trip: { start_date: '2026-05-01', end_date: '2026-05-10' },
  placeExists: true,
  insertError: null,
  updateError: null,
  existing: null,
  fromCalls: {},
  capturedInsert: null,
  capturedUpdate: null,
};

function defaultRow(over: Record<string, unknown> = {}) {
  return {
    id: ACC_ID,
    trip_id: FIXED_TRIP_ID,
    place_id: null,
    hotel_name: 'Park Hyatt',
    check_in_date: '2026-05-01',
    check_out_date: '2026-05-03',
    confirmation: null,
    cost_per_night: null,
    total_cost: null,
    currency: null,
    notes: null,
    created_by: FIXED_USER_ID,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    place: null,
    ...over,
  };
}

function makeChain(table: string) {
  state.fromCalls[table] = (state.fromCalls[table] ?? 0) + 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = async () => ({ data: [defaultRow()], error: null, count: 1 });
  chain.limit = () => chain;
  chain.maybeSingle = async () => {
    if (table === 'trips') return { data: state.trip, error: null };
    if (table === 'places') {
      return state.placeExists
        ? { data: { id: PLACE_ID }, error: null }
        : { data: null, error: null };
    }
    if (table === 'accommodations') {
      return { data: state.existing ?? defaultRow(), error: null };
    }
    return { data: null, error: null };
  };
  chain.single = async () => {
    if (table === 'accommodations') {
      return { data: defaultRow(state.capturedInsert ?? {}), error: null };
    }
    return { data: null, error: null };
  };
  chain.insert = (payload: Record<string, unknown>) => {
    state.capturedInsert = payload;
    return {
      select: () => ({
        single: async () => {
          if (state.insertError)
            return { data: null, error: state.insertError };
          return {
            data: defaultRow({
              ...payload,
              place: null,
            }),
            error: null,
          };
        },
      }),
    };
  };
  chain.update = (payload: Record<string, unknown>) => {
    state.capturedUpdate = payload;
    return {
      eq: () => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              if (state.updateError)
                return { data: null, error: state.updateError };
              return {
                data: defaultRow({ ...payload }),
                error: null,
              };
            },
          }),
        }),
      }),
    };
  };
  chain.delete = () => ({
    eq: () => ({
      eq: async () => ({ error: null }),
    }),
  });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }),
    },
    from: (t: string) => makeChain(t),
  }),
}));

import {
  GET as ACC_LIST_GET,
  POST as ACC_POST,
} from '@/app/api/trips/[id]/accommodations/route';
import {
  PATCH as ACC_PATCH,
  DELETE as ACC_DELETE,
} from '@/app/api/trips/[id]/accommodations/[accommodationId]/route';

const tripCtx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };
const accCtx = {
  params: Promise.resolve({
    id: FIXED_TRIP_ID,
    accommodationId: ACC_ID,
  }),
};

beforeEach(() => {
  role = 'editor';
  state.trip = { start_date: '2026-05-01', end_date: '2026-05-10' };
  state.placeExists = true;
  state.insertError = null;
  state.updateError = null;
  state.existing = null;
  state.fromCalls = {};
  state.capturedInsert = null;
  state.capturedUpdate = null;
  auditCalls.length = 0;
});

function mkPost(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/accommodations`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

function mkPatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/accommodations/${ACC_ID}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('GET /api/trips/[id]/accommodations', () => {
  it('viewer can list', async () => {
    role = 'viewer';
    const res = await ACC_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/accommodations`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.items).toHaveLength(1);
  });

  it('non-member 404', async () => {
    role = 'none';
    const res = await ACC_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/accommodations`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(404);
  });

  it('rejects limit > 100', async () => {
    const res = await ACC_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/accommodations?limit=500`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/trips/[id]/accommodations', () => {
  it('creates with hotel_name only', async () => {
    const res = await ACC_POST(
      mkPost({
        hotel_name: 'Park Hyatt',
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
      }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.capturedInsert?.trip_id).toBe(FIXED_TRIP_ID);
    expect(state.capturedInsert?.created_by).toBe(FIXED_USER_ID);
  });

  it('creates with place_id (verifies place exists)', async () => {
    const res = await ACC_POST(
      mkPost({
        place_id: PLACE_ID,
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
      }),
      tripCtx,
    );
    expect(res.status).toBe(201);
  });

  it('400 place_not_found when place missing', async () => {
    state.placeExists = false;
    const res = await ACC_POST(
      mkPost({
        place_id: PLACE_ID,
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
      }),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('place_not_found');
  });

  it('400 accommodation_dates_outside_trip when out-of-range', async () => {
    const res = await ACC_POST(
      mkPost({
        hotel_name: 'h',
        check_in_date: '2026-04-25',
        check_out_date: '2026-04-30',
      }),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('accommodation_dates_outside_trip');
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await ACC_POST(
      mkPost({
        hotel_name: 'h',
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
      }),
      tripCtx,
    );
    expect(res.status).toBe(403);
  });

  it('non-member 404', async () => {
    role = 'none';
    const res = await ACC_POST(
      mkPost({
        hotel_name: 'h',
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
      }),
      tripCtx,
    );
    expect(res.status).toBe(404);
  });

  it('audit metadata excludes hotel_name and place_id raw values (privacy regression)', async () => {
    await ACC_POST(
      mkPost({
        hotel_name: 'Secret Hideaway',
        check_in_date: '2026-05-01',
        check_out_date: '2026-05-03',
        confirmation: 'TOPSECRET',
      }),
      tripCtx,
    );
    const last = auditCalls[auditCalls.length - 1];
    expect(last).toBeDefined();
    const meta = last?.metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.has_hotel_name).toBe(true);
    expect(meta.has_confirmation).toBe(true);
    // Privacy: raw values must not be in audit metadata.
    expect(JSON.stringify(meta)).not.toContain('Secret Hideaway');
    expect(JSON.stringify(meta)).not.toContain('TOPSECRET');
  });
});

describe('PATCH /api/trips/[id]/accommodations/[id]', () => {
  it('partial patch updating only confirmation succeeds (regression for gated refinement)', async () => {
    state.existing = {
      id: ACC_ID,
      trip_id: FIXED_TRIP_ID,
      place_id: null,
      hotel_name: 'Park Hyatt',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      cost_per_night: null,
      total_cost: null,
      currency: null,
    };
    const res = await ACC_PATCH(mkPatch({ confirmation: 'NEW' }), accCtx);
    expect(res.status).toBe(200);
    expect(state.capturedUpdate).toEqual({ confirmation: 'NEW' });
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await ACC_PATCH(mkPatch({ confirmation: 'X' }), accCtx);
    expect(res.status).toBe(403);
  });

  it('non-member 404', async () => {
    role = 'none';
    const res = await ACC_PATCH(mkPatch({ confirmation: 'X' }), accCtx);
    expect(res.status).toBe(404);
  });

  it('400 dates outside trip range when patching dates', async () => {
    state.existing = {
      id: ACC_ID,
      trip_id: FIXED_TRIP_ID,
      place_id: null,
      hotel_name: 'h',
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
      cost_per_night: null,
      total_cost: null,
      currency: null,
    };
    const res = await ACC_PATCH(
      mkPatch({ check_in_date: '2026-04-01', check_out_date: '2026-04-02' }),
      accCtx,
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/trips/[id]/accommodations/[id]', () => {
  it('204 on owner/editor delete', async () => {
    state.existing = {
      id: ACC_ID,
      trip_id: FIXED_TRIP_ID,
      place_id: null,
      hotel_name: 'h',
      confirmation: null,
      check_in_date: '2026-05-01',
      check_out_date: '2026-05-03',
    };
    const res = await ACC_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/accommodations/${ACC_ID}`,
        { method: 'DELETE' },
      ),
      accCtx,
    );
    expect(res.status).toBe(204);
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await ACC_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/accommodations/${ACC_ID}`,
        { method: 'DELETE' },
      ),
      accCtx,
    );
    expect(res.status).toBe(403);
  });
});
