/**
 * B-014 — API tests for expenses CRUD + balances.
 *
 * Mocks:
 *   - `@/lib/supabase/server` — chainable query builder + auth.getUser + rpc.
 *   - `@/lib/trip-access` — role-gated access check.
 *   - `@/lib/audit` — captures audit log calls.
 *   - `next/headers` — cookies stub for the server-side Supabase client.
 *
 * fromCalls / rpcCalls counters back the N+1 / round-trip-budget assertions
 * (Sprint 3 B-008 left this gap; doing it here per test plan).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  FIXED_USER_ID,
  FIXED_OTHER_USER_ID,
  FIXED_TRIP_ID,
} from '../factories';

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

const EXPENSE_ID = '00000000-0000-4000-8000-000000000e01';
const OTHER_TRIP_ID = '00000000-0000-4000-8000-000000000099';

interface State {
  trip: { start_date: string; end_date: string; base_currency: string } | null;
  acceptedMembers: string[];
  insertError: { message: string } | null;
  updateError: { message: string } | null;
  deleteError: { message: string } | null;
  existing:
    | (Record<string, unknown> & { trip_id: string })
    | null;
  fromCalls: Record<string, number>;
  rpcCalls: Record<string, number>;
  capturedInsert: Record<string, unknown> | null;
  capturedUpdate: Record<string, unknown> | null;
  authUser: { id: string } | null;
  totalSpent: number;
  balanceRows: Array<{
    user_id: string;
    paid: number;
    owes: number;
    net: number;
  }>;
  profileRows: Array<{
    id: string;
    full_name: string | null;
    email: string;
    avatar_url: string | null;
  }>;
}

const state: State = {
  trip: {
    start_date: '2026-05-01',
    end_date: '2026-05-10',
    base_currency: 'EUR',
  },
  acceptedMembers: [FIXED_USER_ID, FIXED_OTHER_USER_ID],
  insertError: null,
  updateError: null,
  deleteError: null,
  existing: null,
  fromCalls: {},
  rpcCalls: {},
  capturedInsert: null,
  capturedUpdate: null,
  authUser: { id: FIXED_USER_ID },
  totalSpent: 100,
  balanceRows: [
    {
      user_id: FIXED_USER_ID,
      paid: 100,
      owes: 50,
      net: 50,
    },
    {
      user_id: FIXED_OTHER_USER_ID,
      paid: 0,
      owes: 50,
      net: -50,
    },
  ],
  profileRows: [
    {
      id: FIXED_USER_ID,
      full_name: 'Alice',
      email: 'alice@example.com',
      avatar_url: null,
    },
    {
      id: FIXED_OTHER_USER_ID,
      full_name: 'Bob',
      email: 'bob@example.com',
      avatar_url: null,
    },
  ],
};

function defaultExpenseRow(over: Record<string, unknown> = {}) {
  return {
    id: EXPENSE_ID,
    trip_id: FIXED_TRIP_ID,
    category: 'food',
    description: 'Sushi dinner',
    amount: 100,
    currency: 'EUR',
    occurred_at: '2026-05-02',
    paid_by: FIXED_USER_ID,
    split_among: [
      { user_id: FIXED_USER_ID, share_pct: 50 },
      { user_id: FIXED_OTHER_USER_ID, share_pct: 50 },
    ],
    created_by: FIXED_USER_ID,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    paid_by_profile: {
      id: FIXED_USER_ID,
      full_name: 'Alice',
      email: 'alice@example.com',
      avatar_url: null,
    },
    ...over,
  };
}

function makeChain(table: string) {
  state.fromCalls[table] = (state.fromCalls[table] ?? 0) + 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.in = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.range = async () => ({
    data: [defaultExpenseRow()],
    error: null,
    count: 1,
  });
  chain.maybeSingle = async () => {
    if (table === 'trips') return { data: state.trip, error: null };
    if (table === 'expenses') {
      return { data: state.existing, error: null };
    }
    return { data: null, error: null };
  };
  chain.single = async () => ({ data: null, error: null });
  chain.insert = (payload: Record<string, unknown>) => {
    state.capturedInsert = payload;
    return {
      select: () => ({
        single: async () => {
          if (state.insertError)
            return { data: null, error: state.insertError };
          return {
            data: defaultExpenseRow(payload),
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
                data: defaultExpenseRow(payload),
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
      eq: async () => ({ error: state.deleteError }),
    }),
  });

  // trip_members membership lookup returns rows for accepted members.
  if (table === 'trip_members') {
    chain.in = () => ({
      // After .in() the route awaits — so make this a thenable.
      then: (
        resolve: (v: { data: { user_id: string }[]; error: null }) => void,
      ) =>
        resolve({
          data: state.acceptedMembers.map((u) => ({ user_id: u })),
          error: null,
        }),
    });
  }
  // profiles.in() lookup for balances
  if (table === 'profiles') {
    chain.in = () => ({
      then: (
        resolve: (v: {
          data: typeof state.profileRows;
          error: null;
        }) => void,
      ) => resolve({ data: state.profileRows, error: null }),
    });
  }

  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authUser } }),
    },
    from: (t: string) => makeChain(t),
    rpc: async (name: string, _args: Record<string, unknown>) => {
      state.rpcCalls[name] = (state.rpcCalls[name] ?? 0) + 1;
      if (name === 'get_trip_expense_total') {
        return { data: state.totalSpent, error: null };
      }
      if (name === 'get_trip_balances') {
        return { data: state.balanceRows, error: null };
      }
      return { data: null, error: null };
    },
  }),
}));

import {
  GET as EXP_LIST_GET,
  POST as EXP_POST,
} from '@/app/api/trips/[id]/expenses/route';
import {
  GET as EXP_GET,
  PATCH as EXP_PATCH,
  DELETE as EXP_DELETE,
} from '@/app/api/trips/[id]/expenses/[expenseId]/route';
import { GET as BAL_GET } from '@/app/api/trips/[id]/balances/route';

const tripCtx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };
const expCtx = {
  params: Promise.resolve({ id: FIXED_TRIP_ID, expenseId: EXPENSE_ID }),
};

beforeEach(() => {
  role = 'editor';
  state.trip = {
    start_date: '2026-05-01',
    end_date: '2026-05-10',
    base_currency: 'EUR',
  };
  state.acceptedMembers = [FIXED_USER_ID, FIXED_OTHER_USER_ID];
  state.insertError = null;
  state.updateError = null;
  state.deleteError = null;
  state.existing = null;
  state.fromCalls = {};
  state.rpcCalls = {};
  state.capturedInsert = null;
  state.capturedUpdate = null;
  state.authUser = { id: FIXED_USER_ID };
  state.totalSpent = 100;
  auditCalls.length = 0;
});

function validBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: 'food',
    description: 'Sushi dinner',
    amount: 100,
    currency: 'EUR',
    occurred_at: '2026-05-02',
    paid_by: FIXED_USER_ID,
    split_among: [
      { user_id: FIXED_USER_ID, share_pct: 50 },
      { user_id: FIXED_OTHER_USER_ID, share_pct: 50 },
    ],
    ...over,
  };
}

function mkPost(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

function mkPatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

// ============================================================================
// GET /expenses (list)
// ============================================================================

describe('GET /api/trips/[id]/expenses', () => {
  it('viewer can list, response includes total_spent', async () => {
    role = 'viewer';
    const res = await EXP_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      total: number;
      total_spent: number;
    };
    expect(body.data).toHaveLength(1);
    expect(body.total_spent).toBe(100);
  });

  it('non-member 404', async () => {
    role = 'none';
    const res = await EXP_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    state.authUser = null;
    const res = await EXP_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(401);
  });

  it('rejects limit > 100', async () => {
    const res = await EXP_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses?limit=500`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });

  it('passes through category and paid_by filters', async () => {
    const res = await EXP_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses?category=food&paid_by=${FIXED_USER_ID}`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
  });

  it('does exactly 1 supabase.from("expenses") call + 1 rpc call (no N+1)', async () => {
    await EXP_LIST_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses`,
      ),
      tripCtx,
    );
    expect(state.fromCalls['expenses']).toBe(1);
    expect(state.rpcCalls['get_trip_expense_total']).toBe(1);
  });
});

// ============================================================================
// POST /expenses
// ============================================================================

describe('POST /api/trips/[id]/expenses', () => {
  it('201 with valid payload; trip_id sourced from URL only', async () => {
    const res = await EXP_POST(mkPost(validBody()), tripCtx);
    expect(res.status).toBe(201);
    // trip_id in insert payload comes from URL param.
    expect(state.capturedInsert?.trip_id).toBe(FIXED_TRIP_ID);
    expect(state.capturedInsert?.created_by).toBe(FIXED_USER_ID);
  });

  it('rejects body.trip_id (strict schema — URL is source of truth)', async () => {
    const res = await EXP_POST(
      mkPost(validBody({ trip_id: OTHER_TRIP_ID })),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await EXP_POST(mkPost(validBody()), tripCtx);
    expect(res.status).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    state.authUser = null;
    const res = await EXP_POST(mkPost(validBody()), tripCtx);
    expect(res.status).toBe(401);
  });

  it('non-member 404', async () => {
    role = 'none';
    const res = await EXP_POST(mkPost(validBody()), tripCtx);
    expect(res.status).toBe(404);
  });

  it('400 invalid_currency when currency != trip base_currency', async () => {
    const res = await EXP_POST(
      mkPost(validBody({ currency: 'USD' })),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_currency');
  });

  it('400 date_out_of_range when occurred_at before trip start', async () => {
    const res = await EXP_POST(
      mkPost(validBody({ occurred_at: '2026-04-15' })),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('date_out_of_range');
  });

  it('400 date_out_of_range when occurred_at after trip end', async () => {
    const res = await EXP_POST(
      mkPost(validBody({ occurred_at: '2026-06-01' })),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('date_out_of_range');
  });

  it('400 member_not_in_trip when paid_by is not an accepted member', async () => {
    const stranger = '00000000-0000-4000-8000-0000000000ff';
    state.acceptedMembers = [FIXED_OTHER_USER_ID]; // paid_by stranger missing
    const res = await EXP_POST(
      mkPost(
        validBody({
          paid_by: stranger,
          split_among: [
            { user_id: stranger, share_pct: 50 },
            { user_id: FIXED_OTHER_USER_ID, share_pct: 50 },
          ],
        }),
      ),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('member_not_in_trip');
  });

  it('400 member_not_in_trip when split_among contains non-member', async () => {
    const stranger = '00000000-0000-4000-8000-0000000000ff';
    state.acceptedMembers = [FIXED_USER_ID];
    const res = await EXP_POST(
      mkPost(
        validBody({
          split_among: [
            { user_id: FIXED_USER_ID, share_pct: 50 },
            { user_id: stranger, share_pct: 50 },
          ],
        }),
      ),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('member_not_in_trip');
  });

  it('400 validation_error on bad payload (negative amount)', async () => {
    const res = await EXP_POST(mkPost(validBody({ amount: -1 })), tripCtx);
    expect(res.status).toBe(400);
  });

  it('logs expense.create audit without raw description (privacy)', async () => {
    await EXP_POST(
      mkPost(validBody({ description: 'TopSecretMassage' })),
      tripCtx,
    );
    const last = auditCalls[auditCalls.length - 1];
    expect(last).toBeDefined();
    expect(last?.action).toBe('expense.create');
    const meta = last?.metadata as Record<string, unknown>;
    // description value must NOT be present in audit metadata.
    expect(JSON.stringify(meta)).not.toContain('TopSecretMassage');
    expect(meta.amount).toBe(100);
    expect(meta.category).toBe('food');
  });
});

// ============================================================================
// GET /expenses/[expenseId]
// ============================================================================

describe('GET /api/trips/[id]/expenses/[expenseId]', () => {
  it('returns expense for viewer', async () => {
    role = 'viewer';
    state.existing = defaultExpenseRow();
    const res = await EXP_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
      ),
      expCtx,
    );
    expect(res.status).toBe(200);
  });

  it('404 when expense not found', async () => {
    state.existing = null;
    const res = await EXP_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
      ),
      expCtx,
    );
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH /expenses/[expenseId]
// ============================================================================

describe('PATCH /api/trips/[id]/expenses/[expenseId]', () => {
  beforeEach(() => {
    state.existing = {
      id: EXPENSE_ID,
      trip_id: FIXED_TRIP_ID,
      paid_by: FIXED_USER_ID,
      split_among: [
        { user_id: FIXED_USER_ID, share_pct: 50 },
        { user_id: FIXED_OTHER_USER_ID, share_pct: 50 },
      ],
      currency: 'EUR',
      occurred_at: '2026-05-02',
    };
  });

  it('200 partial update of description only', async () => {
    const res = await EXP_PATCH(
      mkPatch({ description: 'Updated desc' }),
      expCtx,
    );
    expect(res.status).toBe(200);
    expect(state.capturedUpdate).toEqual({ description: 'Updated desc' });
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await EXP_PATCH(mkPatch({ description: 'x' }), expCtx);
    expect(res.status).toBe(403);
  });

  it('401 unauthenticated', async () => {
    state.authUser = null;
    const res = await EXP_PATCH(mkPatch({ description: 'x' }), expCtx);
    expect(res.status).toBe(401);
  });

  it('404 cross-trip — expense.trip_id != URL trip', async () => {
    state.existing = {
      ...(state.existing as Record<string, unknown>),
      trip_id: OTHER_TRIP_ID,
    } as State['existing'];
    const res = await EXP_PATCH(mkPatch({ description: 'x' }), expCtx);
    expect(res.status).toBe(404);
  });

  it('400 invalid_currency on patch', async () => {
    const res = await EXP_PATCH(mkPatch({ currency: 'USD' }), expCtx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_currency');
  });

  it('400 date_out_of_range on patch', async () => {
    const res = await EXP_PATCH(
      mkPatch({ occurred_at: '2026-04-01' }),
      expCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('date_out_of_range');
  });

  it('400 validation_error on empty patch', async () => {
    const res = await EXP_PATCH(mkPatch({}), expCtx);
    expect(res.status).toBe(400);
  });

  it('400 member_not_in_trip when patching paid_by to non-member', async () => {
    const stranger = '00000000-0000-4000-8000-0000000000ff';
    state.acceptedMembers = [FIXED_USER_ID, FIXED_OTHER_USER_ID];
    const res = await EXP_PATCH(mkPatch({ paid_by: stranger }), expCtx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('member_not_in_trip');
  });

  it('logs expense.update audit', async () => {
    await EXP_PATCH(mkPatch({ description: 'New desc value' }), expCtx);
    const last = auditCalls[auditCalls.length - 1];
    expect(last?.action).toBe('expense.update');
    const meta = last?.metadata as Record<string, unknown>;
    expect(JSON.stringify(meta)).not.toContain('New desc value');
    expect(Array.isArray(meta.fields)).toBe(true);
  });
});

// ============================================================================
// DELETE /expenses/[expenseId]
// ============================================================================

describe('DELETE /api/trips/[id]/expenses/[expenseId]', () => {
  beforeEach(() => {
    state.existing = {
      id: EXPENSE_ID,
      trip_id: FIXED_TRIP_ID,
      amount: 100,
      currency: 'EUR',
      category: 'food',
      occurred_at: '2026-05-02',
    };
  });

  it('204 on editor delete', async () => {
    const res = await EXP_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
        { method: 'DELETE' },
      ),
      expCtx,
    );
    expect(res.status).toBe(204);
  });

  it('viewer 403', async () => {
    role = 'viewer';
    const res = await EXP_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
        { method: 'DELETE' },
      ),
      expCtx,
    );
    expect(res.status).toBe(403);
  });

  it('401 unauthenticated', async () => {
    state.authUser = null;
    const res = await EXP_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
        { method: 'DELETE' },
      ),
      expCtx,
    );
    expect(res.status).toBe(401);
  });

  it('404 cross-trip', async () => {
    state.existing = {
      ...(state.existing as Record<string, unknown>),
      trip_id: OTHER_TRIP_ID,
    } as State['existing'];
    const res = await EXP_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
        { method: 'DELETE' },
      ),
      expCtx,
    );
    expect(res.status).toBe(404);
  });

  it('logs expense.delete audit', async () => {
    await EXP_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/expenses/${EXPENSE_ID}`,
        { method: 'DELETE' },
      ),
      expCtx,
    );
    const last = auditCalls[auditCalls.length - 1];
    expect(last?.action).toBe('expense.delete');
  });
});

// ============================================================================
// GET /balances
// ============================================================================

describe('GET /api/trips/[id]/balances', () => {
  it('200 with member balances for viewer', async () => {
    role = 'viewer';
    const res = await BAL_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/balances`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      balances: Array<{ user_id: string; net: number; full_name: string | null }>;
    };
    expect(body.balances).toHaveLength(2);
    // Sorted by net DESC — creditor first.
    expect(body.balances[0].net).toBe(50);
    expect(body.balances[1].net).toBe(-50);
  });

  it('403 not_a_member when caller has no membership', async () => {
    role = 'none';
    const res = await BAL_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/balances`,
      ),
      tripCtx,
    );
    // Route maps `not_found` reason to 403 not_a_member explicitly.
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_a_member');
  });

  it('401 unauthenticated', async () => {
    state.authUser = null;
    const res = await BAL_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/balances`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(401);
  });

  it('does exactly 1 rpc call + 1 from("profiles") call (no N+1)', async () => {
    await BAL_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/balances`,
      ),
      tripCtx,
    );
    expect(state.rpcCalls['get_trip_balances']).toBe(1);
    expect(state.fromCalls['profiles']).toBe(1);
  });

  it('returns empty list when balance RPC returns no rows', async () => {
    state.balanceRows = [];
    const res = await BAL_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/balances`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balances: unknown[] };
    expect(body.balances).toHaveLength(0);
  });
});
