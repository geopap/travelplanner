/**
 * B-007 — API tests for the transportation list endpoint and the
 * transport-aware POST/PATCH on /api/trips/[id]/items.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID, FIXED_DAY_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
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

const FIXED_TRANSPORT_ID = '00000000-0000-4000-8000-000000000700';
const FIXED_ITEM_ID = '00000000-0000-4000-8000-000000000701';

interface State {
  // GET list
  listRows: Array<Record<string, unknown>>;
  listCount: number;
  fromCalls: Record<string, number>;
  // RPCs
  rpcCreateError: { message: string } | null;
  rpcUpdateError: { message: string } | null;
  rpcCreateResult: { item_id: string; transportation_id: string };
  rpcUpdateResult: {
    item_id: string;
    transportation_id: string | null;
    type: 'transport' | 'lodging' | 'activity' | 'meal' | 'note';
  };
  // existing item lookup (PATCH)
  existingItemType: 'transport' | 'lodging' | 'activity' | 'meal' | 'note' | null;
  // Day verification
  dayBelongsToTrip: boolean;
  // RPC call counters
  rpcCalls: Array<{ name: string; args: unknown }>;
}

const state: State = {
  listRows: [],
  listCount: 0,
  fromCalls: {},
  rpcCreateError: null,
  rpcUpdateError: null,
  rpcCreateResult: {
    item_id: FIXED_ITEM_ID,
    transportation_id: FIXED_TRANSPORT_ID,
  },
  rpcUpdateResult: {
    item_id: FIXED_ITEM_ID,
    transportation_id: FIXED_TRANSPORT_ID,
    type: 'transport',
  },
  existingItemType: 'transport',
  dayBelongsToTrip: true,
  rpcCalls: [],
};

function defaultItemRow() {
  return {
    id: FIXED_ITEM_ID,
    trip_id: FIXED_TRIP_ID,
    day_id: FIXED_DAY_ID,
    type: 'transport',
    title: 'Tokyo → Kyoto',
    start_time: null,
    end_time: null,
    external_url: null,
    cost: null,
    currency: null,
    notes: null,
    created_by: FIXED_USER_ID,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  };
}

function defaultTransportRow() {
  return {
    id: FIXED_TRANSPORT_ID,
    itinerary_item_id: FIXED_ITEM_ID,
    trip_id: FIXED_TRIP_ID,
    mode: 'train',
    carrier: null,
    confirmation: null,
    departure_location: null,
    arrival_location: null,
    departure_time: null,
    arrival_time: null,
    cost: null,
    currency: null,
    notes: null,
    created_by: FIXED_USER_ID,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
  };
}

function makeChain(table: string) {
  state.fromCalls[table] = (state.fromCalls[table] ?? 0) + 1;
  let lastEqId: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: string) => {
    if (col === 'id') lastEqId = val;
    return chain;
  };
  chain.order = () => chain;
  chain.range = async () => ({
    data: state.listRows,
    error: null,
    count: state.listCount,
  });
  chain.limit = () => chain;
  chain.maybeSingle = async () => {
    if (table === 'trip_days') {
      return state.dayBelongsToTrip
        ? { data: { id: FIXED_DAY_ID }, error: null }
        : { data: null, error: null };
    }
    if (table === 'itinerary_items') {
      if (state.existingItemType === null) {
        return { data: null, error: null };
      }
      // Patch lookup or post-mutation re-fetch
      return {
        data: { ...defaultItemRow(), type: state.existingItemType },
        error: null,
      };
    }
    if (table === 'transportation') {
      void lastEqId;
      return { data: defaultTransportRow(), error: null };
    }
    return { data: null, error: null };
  };
  chain.single = async () => {
    if (table === 'itinerary_items') {
      return { data: defaultItemRow(), error: null };
    }
    return { data: null, error: null };
  };
  chain.insert = (payload: Record<string, unknown>) => ({
    select: () => ({
      single: async () => ({
        data: { ...defaultItemRow(), ...payload },
        error: null,
      }),
    }),
  });
  chain.update = () => ({
    eq: () => ({
      eq: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: defaultItemRow(), error: null }),
        }),
      }),
    }),
  });
  chain.delete = () => ({
    eq: () => ({
      eq: () => ({
        select: () => ({
          maybeSingle: async () => ({
            data: { id: FIXED_ITEM_ID },
            error: null,
          }),
        }),
      }),
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
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push({ name, args });
      if (name === 'create_transport_item') {
        if (state.rpcCreateError)
          return { data: null, error: state.rpcCreateError };
        return { data: state.rpcCreateResult, error: null };
      }
      if (name === 'update_transport_item') {
        if (state.rpcUpdateError)
          return { data: null, error: state.rpcUpdateError };
        return { data: state.rpcUpdateResult, error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
  }),
}));

import { GET as TRANSPORT_GET } from '@/app/api/trips/[id]/transportation/route';
import {
  POST as ITEMS_POST,
} from '@/app/api/trips/[id]/items/route';
import {
  PATCH as ITEM_PATCH,
} from '@/app/api/trips/[id]/items/[itemId]/route';

const tripCtx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };
const itemCtx = {
  params: Promise.resolve({ id: FIXED_TRIP_ID, itemId: FIXED_ITEM_ID }),
};

beforeEach(() => {
  role = 'editor';
  state.listRows = [];
  state.listCount = 0;
  state.fromCalls = {};
  state.rpcCreateError = null;
  state.rpcUpdateError = null;
  state.rpcCreateResult = {
    item_id: FIXED_ITEM_ID,
    transportation_id: FIXED_TRANSPORT_ID,
  };
  state.rpcUpdateResult = {
    item_id: FIXED_ITEM_ID,
    transportation_id: FIXED_TRANSPORT_ID,
    type: 'transport',
  };
  state.existingItemType = 'transport';
  state.dayBelongsToTrip = true;
  state.rpcCalls = [];
});

// ---------------------------------------------------------------------------
// GET /api/trips/[id]/transportation
// ---------------------------------------------------------------------------

describe('GET /api/trips/[id]/transportation', () => {
  it('viewer can read', async () => {
    role = 'viewer';
    const res = await TRANSPORT_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/transportation`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
  });

  it('non-member returns 403', async () => {
    role = 'none';
    const res = await TRANSPORT_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/transportation`,
      ),
      tripCtx,
    );
    // route uses notFound() for not_found reason; test contract = 404
    expect(res.status).toBe(404);
  });

  it('rejects limit > 100', async () => {
    const res = await TRANSPORT_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/transportation?limit=500`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });

  it('rejects page=0', async () => {
    const res = await TRANSPORT_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/transportation?page=0`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });

  it('returns paginated payload (single query — no N+1)', async () => {
    state.listRows = [
      {
        ...defaultTransportRow(),
        item: { id: FIXED_ITEM_ID, day_id: FIXED_DAY_ID, title: 'leg' },
      },
    ];
    state.listCount = 1;
    const res = await TRANSPORT_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/transportation`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      total: number;
      page: number;
      limit: number;
    };
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
    // Only one .from('transportation') call — defense against N+1.
    expect(state.fromCalls['transportation']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST transport variant
// ---------------------------------------------------------------------------

function mkPost(body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost/api/trips/${FIXED_TRIP_ID}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/trips/[id]/items — transport variant', () => {
  it('201 on valid transport payload', async () => {
    const res = await ITEMS_POST(
      mkPost({
        type: 'transport',
        title: 'Tokyo → Kyoto',
        day_id: FIXED_DAY_ID,
        transportation: { mode: 'train' },
      }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.rpcCalls.find((c) => c.name === 'create_transport_item')).toBeDefined();
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await ITEMS_POST(
      mkPost({
        type: 'transport',
        title: 'x',
        day_id: FIXED_DAY_ID,
        transportation: { mode: 'flight' },
      }),
      tripCtx,
    );
    expect(res.status).toBe(403);
  });

  it('non-member 404', async () => {
    role = 'none';
    const res = await ITEMS_POST(
      mkPost({
        type: 'transport',
        title: 'x',
        day_id: FIXED_DAY_ID,
        transportation: { mode: 'flight' },
      }),
      tripCtx,
    );
    expect(res.status).toBe(404);
  });

  it('AC-10: rejects parent cost on transport (validation 400)', async () => {
    const res = await ITEMS_POST(
      mkPost({
        type: 'transport',
        title: 'x',
        day_id: FIXED_DAY_ID,
        cost: 100,
        currency: 'EUR',
        transportation: { mode: 'flight' },
      }),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH transport-related
// ---------------------------------------------------------------------------

function mkPatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/items/${FIXED_ITEM_ID}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('PATCH /api/trips/[id]/items/[itemId] — transport flows', () => {
  it('edit transport item via RPC', async () => {
    state.existingItemType = 'transport';
    const res = await ITEM_PATCH(
      mkPatch({ transportation: { carrier: 'JAL' } }),
      itemCtx,
    );
    expect(res.status).toBe(200);
    expect(
      state.rpcCalls.find((c) => c.name === 'update_transport_item'),
    ).toBeDefined();
  });

  it('type-change transport→activity calls update RPC (cascades transportation row deletion server-side)', async () => {
    state.existingItemType = 'transport';
    state.rpcUpdateResult = {
      item_id: FIXED_ITEM_ID,
      transportation_id: null,
      type: 'activity',
    };
    const res = await ITEM_PATCH(mkPatch({ type: 'activity' }), itemCtx);
    expect(res.status).toBe(200);
    expect(
      state.rpcCalls.find((c) => c.name === 'update_transport_item'),
    ).toBeDefined();
  });

  it('type-change activity→transport requires transportation payload', async () => {
    state.existingItemType = 'activity';
    const res = await ITEM_PATCH(mkPatch({ type: 'transport' }), itemCtx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('transport_payload_required');
  });

  it('type-change activity→transport with payload calls update RPC', async () => {
    state.existingItemType = 'activity';
    const res = await ITEM_PATCH(
      mkPatch({ type: 'transport', transportation: { mode: 'flight' } }),
      itemCtx,
    );
    expect(res.status).toBe(200);
    expect(
      state.rpcCalls.find((c) => c.name === 'update_transport_item'),
    ).toBeDefined();
  });

  it('AC-10: rejects parent cost when target type is transport', async () => {
    state.existingItemType = 'transport';
    const res = await ITEM_PATCH(mkPatch({ cost: 50 }), itemCtx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('transport_cost_on_item_forbidden');
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await ITEM_PATCH(
      mkPatch({ transportation: { carrier: 'JAL' } }),
      itemCtx,
    );
    expect(res.status).toBe(403);
  });
});
