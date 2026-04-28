/**
 * B-013 — Member-role API route tests.
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

let callerRole: 'viewer' | 'editor' | 'owner' | 'none' = 'owner';
vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async (
    _sb: unknown,
    _trip: string,
    _user: string,
    required: 'viewer' | 'editor' | 'owner',
  ) => {
    if (callerRole === 'none') return { ok: false, reason: 'not_found' };
    const rank: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
    if (rank[callerRole] < rank[required])
      return { ok: false, reason: 'forbidden' };
    return { ok: true, role: callerRole };
  },
}));

interface RpcCall {
  name: string;
  args: unknown;
}

interface State {
  members: Array<Record<string, unknown>>;
  totalMembers: number;
  target:
    | {
        trip_id: string;
        user_id: string;
        role: 'owner' | 'editor' | 'viewer';
        status: 'accepted' | 'pending' | 'revoked';
      }
    | null;
  rpcResult:
    | { trip_id: string; user_id: string; role: string; status: string; invited_at: string; invited_by: string | null; accepted_at: string | null }
    | null;
  rpcError: { message: string } | null;
  deleteError: { message: string } | null;
  rpcCalls: RpcCall[];
}

const state: State = {
  members: [],
  totalMembers: 0,
  target: {
    trip_id: FIXED_TRIP_ID,
    user_id: FIXED_OTHER_USER_ID,
    role: 'editor',
    status: 'accepted',
  },
  rpcResult: {
    trip_id: FIXED_TRIP_ID,
    user_id: FIXED_OTHER_USER_ID,
    role: 'owner',
    status: 'accepted',
    invited_at: '2026-04-01T00:00:00Z',
    invited_by: FIXED_USER_ID,
    accepted_at: '2026-04-02T00:00:00Z',
  },
  rpcError: null,
  deleteError: null,
  rpcCalls: [],
};

function makeChain(_table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = async () => ({
    data: state.members,
    error: null,
    count: state.totalMembers,
  });
  chain.maybeSingle = async () => ({ data: state.target, error: null });
  chain.delete = () => ({
    eq: () => ({
      eq: async () =>
        state.deleteError
          ? { error: state.deleteError }
          : { error: null },
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
      if (state.rpcError) return { data: null, error: state.rpcError };
      return { data: state.rpcResult, error: null };
    },
  }),
}));

import { GET as MEMBERS_GET } from '@/app/api/trips/[id]/members/route';
import {
  PATCH as MEMBER_PATCH,
  DELETE as MEMBER_DELETE,
} from '@/app/api/trips/[id]/members/[userId]/route';

const tripCtx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };
const memberCtx = (userId: string) => ({
  params: Promise.resolve({ id: FIXED_TRIP_ID, userId }),
});

beforeEach(() => {
  callerRole = 'owner';
  state.members = [];
  state.totalMembers = 0;
  state.target = {
    trip_id: FIXED_TRIP_ID,
    user_id: FIXED_OTHER_USER_ID,
    role: 'editor',
    status: 'accepted',
  };
  state.rpcResult = {
    trip_id: FIXED_TRIP_ID,
    user_id: FIXED_OTHER_USER_ID,
    role: 'owner',
    status: 'accepted',
    invited_at: '2026-04-01T00:00:00Z',
    invited_by: FIXED_USER_ID,
    accepted_at: '2026-04-02T00:00:00Z',
  };
  state.rpcError = null;
  state.deleteError = null;
  state.rpcCalls = [];
  auditCalls.length = 0;
});

function mkPatch(body: Record<string, unknown>): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_OTHER_USER_ID}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

// ---------------------------------------------------------------------------
// GET /api/trips/[id]/members
// ---------------------------------------------------------------------------

describe('GET /api/trips/[id]/members', () => {
  it('viewer can read', async () => {
    callerRole = 'viewer';
    state.members = [
      {
        trip_id: FIXED_TRIP_ID,
        user_id: FIXED_USER_ID,
        role: 'owner',
        status: 'accepted',
        invited_by: null,
        invited_at: '2026-04-01T00:00:00Z',
        accepted_at: '2026-04-02T00:00:00Z',
        profile: {
          email: 'a@b.com',
          full_name: 'Alice',
          avatar_url: null,
        },
      },
    ];
    state.totalMembers = 1;
    const res = await MEMBERS_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: unknown[]; total: number };
    expect(body.members).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('non-member returns 403 not_a_member (no leak)', async () => {
    callerRole = 'none';
    const res = await MEMBERS_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_a_member');
  });

  it('rejects bad pagination', async () => {
    const res = await MEMBERS_GET(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members?limit=999`,
      ),
      tripCtx,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/trips/[id]/members/[userId]
// ---------------------------------------------------------------------------

describe('PATCH /api/trips/[id]/members/[userId]', () => {
  it('owner can change role', async () => {
    const res = await MEMBER_PATCH(
      mkPatch({ role: 'owner' }),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(200);
    expect(
      state.rpcCalls.find((c) => c.name === 'change_member_role'),
    ).toBeDefined();
  });

  it('editor cannot change role (403)', async () => {
    callerRole = 'editor';
    const res = await MEMBER_PATCH(
      mkPatch({ role: 'editor' }),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(403);
  });

  it('non-member returns 403 not_a_member', async () => {
    callerRole = 'none';
    const res = await MEMBER_PATCH(
      mkPatch({ role: 'editor' }),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_a_member');
  });

  it('sole-owner self-demote → 409 cannot_demote_sole_owner', async () => {
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_USER_ID,
      role: 'owner',
      status: 'accepted',
    };
    state.rpcError = { message: 'cannot_demote_sole_owner' };
    const res = await MEMBER_PATCH(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_USER_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: 'editor' }),
          headers: { 'content-type': 'application/json' },
        },
      ),
      memberCtx(FIXED_USER_ID),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('cannot_demote_sole_owner');
  });

  it('rejects invalid role with 400 validation', async () => {
    const res = await MEMBER_PATCH(
      mkPatch({ role: 'admin' }),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(400);
  });

  it('rejects extra fields (immutable cols protection — schema-strict)', async () => {
    const res = await MEMBER_PATCH(
      mkPatch({ role: 'editor', user_id: 'foo', joined_at: 'bar' }),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(400);
  });

  it('promoting another member to owner does NOT demote existing owner (multi-owner)', async () => {
    // RPC returns the target as new owner; the route does not emit any update
    // for the caller's row — assert no extra RPC call beyond change_member_role.
    state.rpcResult = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_OTHER_USER_ID,
      role: 'owner',
      status: 'accepted',
      invited_at: '2026-04-01T00:00:00Z',
      invited_by: FIXED_USER_ID,
      accepted_at: '2026-04-02T00:00:00Z',
    };
    const res = await MEMBER_PATCH(
      mkPatch({ role: 'owner' }),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(200);
    const calls = state.rpcCalls.filter(
      (c) => c.name === 'change_member_role',
    );
    expect(calls).toHaveLength(1);
  });

  it('audit log records from_role and to_role only (no PII)', async () => {
    await MEMBER_PATCH(
      mkPatch({ role: 'owner' }),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    const last = auditCalls[auditCalls.length - 1];
    const meta = last?.metadata as Record<string, unknown>;
    expect(meta.from_role).toBe('editor');
    expect(meta.to_role).toBe('owner');
    expect(JSON.stringify(meta)).not.toMatch(/@/); // no email leak
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/trips/[id]/members/[userId]
// ---------------------------------------------------------------------------

describe('DELETE /api/trips/[id]/members/[userId]', () => {
  it('owner can remove other member', async () => {
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_OTHER_USER_ID,
      role: 'editor',
      status: 'accepted',
    };
    const res = await MEMBER_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_OTHER_USER_ID}`,
        { method: 'DELETE' },
      ),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(204);
  });

  it('owner self-delete → 403 owner_self_delete_forbidden', async () => {
    callerRole = 'owner';
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_USER_ID,
      role: 'owner',
      status: 'accepted',
    };
    const res = await MEMBER_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_USER_ID}`,
        { method: 'DELETE' },
      ),
      memberCtx(FIXED_USER_ID),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('owner_self_delete_forbidden');
  });

  it('editor self-leave → 204', async () => {
    callerRole = 'editor';
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_USER_ID,
      role: 'editor',
      status: 'accepted',
    };
    const res = await MEMBER_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_USER_ID}`,
        { method: 'DELETE' },
      ),
      memberCtx(FIXED_USER_ID),
    );
    expect(res.status).toBe(204);
  });

  it('viewer self-leave → 204', async () => {
    callerRole = 'viewer';
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_USER_ID,
      role: 'viewer',
      status: 'accepted',
    };
    const res = await MEMBER_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_USER_ID}`,
        { method: 'DELETE' },
      ),
      memberCtx(FIXED_USER_ID),
    );
    expect(res.status).toBe(204);
  });

  it('viewer cannot remove other member (403)', async () => {
    callerRole = 'viewer';
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_OTHER_USER_ID,
      role: 'editor',
      status: 'accepted',
    };
    const res = await MEMBER_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_OTHER_USER_ID}`,
        { method: 'DELETE' },
      ),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(403);
  });

  it('editor cannot remove other member (403)', async () => {
    callerRole = 'editor';
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_OTHER_USER_ID,
      role: 'editor',
      status: 'accepted',
    };
    const res = await MEMBER_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_OTHER_USER_ID}`,
        { method: 'DELETE' },
      ),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(403);
  });

  it('non-member 403 not_a_member', async () => {
    callerRole = 'none';
    const res = await MEMBER_DELETE(
      new NextRequest(
        `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_OTHER_USER_ID}`,
        { method: 'DELETE' },
      ),
      memberCtx(FIXED_OTHER_USER_ID),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_a_member');
  });
});

// ---------------------------------------------------------------------------
// Sole-owner self-demote race — best-effort given vitest single-threaded.
// ---------------------------------------------------------------------------

describe('sole-owner self-demote race', () => {
  it('concurrent demotes — at least one receives 409', async () => {
    state.target = {
      trip_id: FIXED_TRIP_ID,
      user_id: FIXED_USER_ID,
      role: 'owner',
      status: 'accepted',
    };
    // The RPC raises cannot_demote_sole_owner deterministically because there
    // is only one owner in the simulated DB. Both concurrent calls hit the
    // same guard.
    state.rpcError = { message: 'cannot_demote_sole_owner' };
    const reqs = [0, 1].map(
      () =>
        new NextRequest(
          `http://localhost/api/trips/${FIXED_TRIP_ID}/members/${FIXED_USER_ID}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ role: 'editor' }),
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    const results = await Promise.all(
      reqs.map((r) => MEMBER_PATCH(r, memberCtx(FIXED_USER_ID))),
    );
    expect(results.some((r) => r.status === 409)).toBe(true);
  });
});
