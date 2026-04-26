import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  FIXED_USER_ID,
  FIXED_OTHER_USER_ID,
  FIXED_TRIP_ID,
} from '../factories';

// ---------------------------------------------------------------------------
// Shared next/headers + audit mocks. All four invitation routes need them.
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (p: Record<string, unknown>) => {
    auditCalls.push(p);
  },
}));

// ---------------------------------------------------------------------------
// Per-test-controllable state
// ---------------------------------------------------------------------------

type AccessRole = 'owner' | 'editor' | 'viewer' | 'none';

interface FakeState {
  userId: string | null;
  accessRole: AccessRole;
  // Insertion control for trip_invitations
  insertError: { code?: string } | null;
  insertedRow: Record<string, unknown> | null;
  // List control
  listRows: Array<Record<string, unknown>>;
  listCount: number;
  listError: unknown;
  // RPC control (lookup/accept)
  rpcLookupRow: Record<string, unknown> | null;
  rpcLookupError: { message?: string } | null;
  rpcAcceptRow: { trip_id: string; role: string } | null;
  rpcAcceptError: { message?: string } | null;
  // Concurrency: when true, rpc('accept_invitation') alternates success/conflict
  concurrencyMode: boolean;
  concurrencyAcceptCount: number;
}

const state: FakeState = {
  userId: FIXED_USER_ID,
  accessRole: 'owner',
  insertError: null,
  insertedRow: null,
  listRows: [],
  listCount: 0,
  listError: null,
  rpcLookupRow: null,
  rpcLookupError: null,
  rpcAcceptRow: null,
  rpcAcceptError: null,
  concurrencyMode: false,
  concurrencyAcceptCount: 0,
};

// trip_access mock — explicit to avoid pulling membership from the DB chain.
vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async () => {
    if (state.accessRole === 'none')
      return { ok: false as const, reason: 'not_found' as const };
    if (state.accessRole === 'owner')
      return { ok: true as const, role: 'owner' as const };
    return { ok: false as const, reason: 'forbidden' as const };
  },
}));

// rate-limit: real implementation, but we reset between tests via resetKey.
// Importing it here avoids re-mocking and gives us realistic 429 behaviour.
import { resetKey } from '@/lib/rate-limit';

// Supabase mock — covers .from('trip_invitations') chains and .rpc().
function makeChain(table: string) {
  const chain: Record<string, unknown> = {};

  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.not = () => chain;
  chain.gt = () => chain;
  chain.lte = () => chain;
  chain.order = () => chain;

  // INSERT path
  chain.insert = (row: Record<string, unknown>) => ({
    select: () => ({
      single: async () => {
        if (state.insertError) {
          return { data: null, error: state.insertError };
        }
        if (table !== 'trip_invitations') {
          return { data: null, error: { code: 'unexpected_table' } };
        }
        const inserted = {
          id: '00000000-0000-4000-8000-0000000000bb',
          trip_id: row.trip_id,
          email: row.email,
          role: row.role,
          expires_at: row.expires_at,
          created_at: '2026-04-26T10:00:00.000Z',
        };
        state.insertedRow = inserted;
        return { data: inserted, error: null };
      },
    }),
  });

  // RANGE returns a thenable that is also chainable — supabase-js builders
  // continue to expose .is/.not/.gt/.lte after .range() until awaited.
  chain.range = () => {
    const result = state.listError
      ? { data: null, error: state.listError, count: 0 }
      : { data: state.listRows, error: null, count: state.listCount };
    const thenableChain: Record<string, unknown> = {
      is: () => thenableChain,
      not: () => thenableChain,
      gt: () => thenableChain,
      lte: () => thenableChain,
      eq: () => thenableChain,
      order: () => thenableChain,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return thenableChain;
  };

  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.userId ? { id: state.userId } : null },
      }),
    },
    from: (t: string) => makeChain(t),
    rpc: async (fn: string) => {
      if (fn === 'get_invitation_by_token') {
        if (state.rpcLookupError)
          return { data: null, error: state.rpcLookupError };
        return {
          data: state.rpcLookupRow ? [state.rpcLookupRow] : [],
          error: null,
        };
      }
      if (fn === 'accept_invitation') {
        if (state.concurrencyMode) {
          state.concurrencyAcceptCount += 1;
          if (state.concurrencyAcceptCount === 1) {
            return {
              data: [{ trip_id: FIXED_TRIP_ID, role: 'editor' }],
              error: null,
            };
          }
          return {
            data: null,
            error: { message: 'token_used' },
          };
        }
        if (state.rpcAcceptError)
          return { data: null, error: state.rpcAcceptError };
        return {
          data: state.rpcAcceptRow ? [state.rpcAcceptRow] : [],
          error: null,
        };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
  }),
}));

// ---------------------------------------------------------------------------
// Route handlers — imported AFTER mocks
// ---------------------------------------------------------------------------

import {
  POST as InvitationsCreatePOST,
  GET as InvitationsListGET,
} from '@/app/api/trips/[tripId]/invitations/route';
import { GET as InvitationsLookupGET } from '@/app/api/invitations/[token]/route';
import { POST as InvitationsAcceptPOST } from '@/app/api/invitations/[token]/accept/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postCreateReq(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/invitations`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

function listReq(query = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/invitations${query}`,
    { method: 'GET' },
  );
}

function lookupReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/invitations/some-token`, {
    method: 'GET',
    headers,
  });
}

function acceptReq(): NextRequest {
  return new NextRequest(
    `http://localhost/api/invitations/some-token/accept`,
    { method: 'POST' },
  );
}

const tripCtx = (tripId = FIXED_TRIP_ID) => ({
  params: Promise.resolve({ tripId }),
});
const tokenCtx = (token = 'some-token') => ({
  params: Promise.resolve({ token }),
});

beforeEach(() => {
  state.userId = FIXED_USER_ID;
  state.accessRole = 'owner';
  state.insertError = null;
  state.insertedRow = null;
  state.listRows = [];
  state.listCount = 0;
  state.listError = null;
  state.rpcLookupRow = null;
  state.rpcLookupError = null;
  state.rpcAcceptRow = null;
  state.rpcAcceptError = null;
  state.concurrencyMode = false;
  state.concurrencyAcceptCount = 0;
  auditCalls.length = 0;
});

afterEach(() => {
  // Clear all rate-limit buckets we may have touched. resetKey is no-op when key absent.
  resetKey(`inv-create:${FIXED_USER_ID}`);
  resetKey(`inv-create:${FIXED_OTHER_USER_ID}`);
  resetKey(`inv-accept:${FIXED_USER_ID}`);
  resetKey(`inv-accept:${FIXED_OTHER_USER_ID}`);
  resetKey('inv-lookup:unknown');
  resetKey('inv-lookup:1.2.3.4');
});

// ===========================================================================
// POST /api/trips/[tripId]/invitations
// ===========================================================================

describe('POST /api/trips/[tripId]/invitations', () => {
  it('owner creates invite for editor → 201 with invite_url + ~48h expiry', async () => {
    const before = Date.now();
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'alice@example.com', role: 'editor' }),
      tripCtx(),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      invitation: {
        id: string;
        email: string;
        role: string;
        expires_at: string;
        invite_url: string;
      };
    };
    expect(json.invitation.role).toBe('editor');
    expect(json.invitation.email).toBe('alice@example.com');
    expect(json.invitation.invite_url).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);
    const exp = Date.parse(json.invitation.expires_at);
    const fortyEightH = 48 * 60 * 60 * 1000;
    // tolerate up to 5s test runtime
    expect(exp - before).toBeGreaterThan(fortyEightH - 5_000);
    expect(exp - before).toBeLessThan(fortyEightH + 5_000);
  });

  it('owner creates invite for viewer → 201', async () => {
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'bob@example.com', role: 'viewer' }),
      tripCtx(),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      invitation: { role: string };
    };
    expect(json.invitation.role).toBe('viewer');
  });

  it('editor (non-owner) inviting → 403', async () => {
    state.accessRole = 'editor';
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'a@example.com', role: 'editor' }),
      tripCtx(),
    );
    expect(res.status).toBe(403);
  });

  it('viewer inviting → 403', async () => {
    state.accessRole = 'viewer';
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'a@example.com', role: 'editor' }),
      tripCtx(),
    );
    expect(res.status).toBe(403);
  });

  it('anonymous → 401', async () => {
    state.userId = null;
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'a@example.com', role: 'editor' }),
      tripCtx(),
    );
    expect(res.status).toBe(401);
  });

  it('invalid email → 400', async () => {
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'not-an-email', role: 'editor' }),
      tripCtx(),
    );
    expect(res.status).toBe(400);
  });

  it('role "owner" → 400', async () => {
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'a@example.com', role: 'owner' }),
      tripCtx(),
    );
    expect(res.status).toBe(400);
  });

  it('duplicate active invitation → 409 invitation_pending_exists', async () => {
    state.insertError = { code: '23505' };
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'dup@example.com', role: 'editor' }),
      tripCtx(),
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      error: { code: string; details: { code?: string } };
    };
    expect(json.error.details.code).toBe('invitation_pending_exists');
  });

  it('email is lowercased server-side before insert', async () => {
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'MIXED@Example.COM', role: 'viewer' }),
      tripCtx(),
    );
    expect(res.status).toBe(201);
    expect(state.insertedRow?.email).toBe('mixed@example.com');
  });

  it('audit log written with hashed email (16 hex chars), no raw email', async () => {
    const res = await InvitationsCreatePOST(
      postCreateReq({ email: 'audit@example.com', role: 'editor' }),
      tripCtx(),
    );
    expect(res.status).toBe(201);
    const log = auditCalls.find(
      (a) => a.action === 'invitation_created',
    );
    expect(log).toBeDefined();
    const md = log?.metadata as Record<string, unknown>;
    expect(md.role).toBe('editor');
    expect(typeof md.email_hash).toBe('string');
    expect(md.email_hash).toMatch(/^[a-f0-9]{16}$/);
    // No raw email anywhere in metadata.
    expect(JSON.stringify(md)).not.toContain('audit@example.com');
  });

  it('11th create within an hour → 429', async () => {
    // Use a unique user so the bucket is fresh.
    const uniqueUser = '00000000-0000-4000-8000-0000000000c1';
    state.userId = uniqueUser;
    resetKey(`inv-create:${uniqueUser}`);
    for (let i = 0; i < 10; i++) {
      const res = await InvitationsCreatePOST(
        postCreateReq({
          email: `user${i}@example.com`,
          role: 'editor',
        }),
        tripCtx(),
      );
      expect(res.status).toBe(201);
    }
    const res11 = await InvitationsCreatePOST(
      postCreateReq({ email: 'user11@example.com', role: 'editor' }),
      tripCtx(),
    );
    expect(res11.status).toBe(429);
    resetKey(`inv-create:${uniqueUser}`);
  });
});

// ===========================================================================
// GET /api/trips/[tripId]/invitations
// ===========================================================================

describe('GET /api/trips/[tripId]/invitations', () => {
  it('owner lists pending invitations → 200, items[].token NOT present', async () => {
    state.listRows = [
      {
        id: '00000000-0000-4000-8000-0000000000d1',
        trip_id: FIXED_TRIP_ID,
        email: 'a@example.com',
        role: 'editor',
        expires_at: '2026-05-01T00:00:00Z',
        created_by: FIXED_USER_ID,
        accepted_by_user_id: null,
        accepted_at: null,
        revoked_at: null,
        created_at: '2026-04-26T10:00:00Z',
      },
      {
        id: '00000000-0000-4000-8000-0000000000d2',
        trip_id: FIXED_TRIP_ID,
        email: 'b@example.com',
        role: 'viewer',
        expires_at: '2026-05-01T00:00:00Z',
        created_by: FIXED_USER_ID,
        accepted_by_user_id: null,
        accepted_at: null,
        revoked_at: null,
        created_at: '2026-04-26T11:00:00Z',
      },
    ];
    state.listCount = 2;
    const res = await InvitationsListGET(listReq(), tripCtx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
      page: number;
      limit: number;
    };
    expect(json.items.length).toBe(2);
    expect(json.total).toBe(2);
    for (const item of json.items) {
      expect(Object.prototype.hasOwnProperty.call(item, 'token')).toBe(false);
    }
  });

  it('honours pagination (page=1&limit=2)', async () => {
    state.listRows = [{}, {}];
    state.listCount = 5;
    const res = await InvitationsListGET(
      listReq('?page=1&limit=2'),
      tripCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: unknown[];
      page: number;
      limit: number;
      total: number;
    };
    expect(json.page).toBe(1);
    expect(json.limit).toBe(2);
    expect(json.items.length).toBe(2);
    expect(json.total).toBe(5);
  });

  it('honours pagination (page=2 returns rest)', async () => {
    state.listRows = [{}, {}, {}];
    state.listCount = 5;
    const res = await InvitationsListGET(
      listReq('?page=2&limit=2'),
      tripCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      items: unknown[];
      page: number;
      total: number;
    };
    expect(json.page).toBe(2);
    expect(json.total).toBe(5);
  });

  it('editor → 403', async () => {
    state.accessRole = 'editor';
    const res = await InvitationsListGET(listReq(), tripCtx());
    expect(res.status).toBe(403);
  });

  it('anonymous → 401', async () => {
    state.userId = null;
    const res = await InvitationsListGET(listReq(), tripCtx());
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// GET /api/invitations/[token] (public)
// ===========================================================================

describe('GET /api/invitations/[token] — public lookup', () => {
  it('valid pending → 200 with trip details', async () => {
    state.rpcLookupRow = {
      status: 'pending',
      trip_id: FIXED_TRIP_ID,
      trip_name: 'Japan 2026',
      inviter_name: 'George',
      email: 'guest@example.com',
      role: 'editor',
      expires_at: '2026-05-01T00:00:00Z',
    };
    const res = await InvitationsLookupGET(
      lookupReq({ 'x-forwarded-for': '1.2.3.4' }),
      tokenCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      status: string;
      trip_name: string;
      inviter_name: string;
      role: string;
      expires_at: string;
    };
    expect(json.status).toBe('pending');
    expect(json.trip_name).toBe('Japan 2026');
    expect(json.inviter_name).toBe('George');
    expect(json.role).toBe('editor');
    expect(json.expires_at).toBe('2026-05-01T00:00:00Z');
  });

  it('expired → 200 status only', async () => {
    state.rpcLookupRow = {
      status: 'expired',
      trip_id: null,
      trip_name: null,
      inviter_name: null,
      email: null,
      role: null,
      expires_at: null,
    };
    const res = await InvitationsLookupGET(
      lookupReq({ 'x-forwarded-for': '1.2.3.4' }),
      tokenCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('expired');
    expect(json.trip_name).toBeUndefined();
    expect(json.inviter_name).toBeUndefined();
    expect(json.role).toBeUndefined();
    expect(json.expires_at).toBeUndefined();
  });

  it('used → 200 status only', async () => {
    state.rpcLookupRow = { status: 'used' };
    const res = await InvitationsLookupGET(
      lookupReq({ 'x-forwarded-for': '1.2.3.4' }),
      tokenCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('used');
    expect(Object.keys(json)).toEqual(['status']);
  });

  it('revoked → 200 status only', async () => {
    state.rpcLookupRow = { status: 'revoked' };
    const res = await InvitationsLookupGET(
      lookupReq({ 'x-forwarded-for': '1.2.3.4' }),
      tokenCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('revoked');
    expect(Object.keys(json)).toEqual(['status']);
  });

  it('invalid (not found) → 200 status only', async () => {
    state.rpcLookupRow = null; // empty array → invalid
    const res = await InvitationsLookupGET(
      lookupReq({ 'x-forwarded-for': '1.2.3.4' }),
      tokenCtx(),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('invalid');
    expect(Object.keys(json)).toEqual(['status']);
  });

  it('anonymous caller is allowed (no auth required)', async () => {
    state.userId = null;
    state.rpcLookupRow = {
      status: 'pending',
      trip_id: FIXED_TRIP_ID,
      trip_name: 'Japan 2026',
      inviter_name: 'George',
      email: 'guest@example.com',
      role: 'viewer',
      expires_at: '2026-05-01T00:00:00Z',
    };
    const res = await InvitationsLookupGET(
      lookupReq({ 'x-forwarded-for': '5.6.7.8' }),
      tokenCtx(),
    );
    expect(res.status).toBe(200);
    resetKey('inv-lookup:5.6.7.8');
  });

  it('rate limit on shared unknown IP bucket: 6th request → 429', async () => {
    resetKey('inv-lookup:unknown');
    state.rpcLookupRow = { status: 'invalid' };
    for (let i = 0; i < 5; i++) {
      const res = await InvitationsLookupGET(lookupReq(), tokenCtx());
      expect(res.status).toBe(200);
    }
    const res6 = await InvitationsLookupGET(lookupReq(), tokenCtx());
    expect(res6.status).toBe(429);
    resetKey('inv-lookup:unknown');
  });
});

// ===========================================================================
// POST /api/invitations/[token]/accept
// ===========================================================================

describe('POST /api/invitations/[token]/accept', () => {
  it('authenticated invitee accepts → 200 with {trip_id, role}', async () => {
    state.rpcAcceptRow = { trip_id: FIXED_TRIP_ID, role: 'editor' };
    const res = await InvitationsAcceptPOST(acceptReq(), tokenCtx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { trip_id: string; role: string };
    expect(json.trip_id).toBe(FIXED_TRIP_ID);
    expect(json.role).toBe('editor');
    const log = auditCalls.find((a) => a.action === 'invitation_accepted');
    expect(log).toBeDefined();
    expect((log?.metadata as Record<string, unknown>).role).toBe('editor');
  });

  it('anonymous → 401', async () => {
    state.userId = null;
    const res = await InvitationsAcceptPOST(acceptReq(), tokenCtx());
    expect(res.status).toBe(401);
  });

  it('already-used → 409 with envelope code "conflict" and message text', async () => {
    state.rpcAcceptError = { message: 'token_used' };
    const res = await InvitationsAcceptPOST(acceptReq(), tokenCtx());
    expect(res.status).toBe(409);
    const json = (await res.json()) as {
      error: { code: string; message: string };
    };
    // Envelope code is the literal string the route uses for conflicts.
    expect(json.error.code).toBe('conflict');
    expect(json.error.message).toMatch(/already used/i);
  });

  it('expired → 410 with envelope code "token_expired" (NOT "gone")', async () => {
    state.rpcAcceptError = { message: 'token_expired' };
    const res = await InvitationsAcceptPOST(acceptReq(), tokenCtx());
    expect(res.status).toBe(410);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('token_expired');
    expect(json.error.code).not.toBe('gone');
  });

  it('revoked → 410 with envelope code "token_revoked" (NOT "gone")', async () => {
    state.rpcAcceptError = { message: 'token_revoked' };
    const res = await InvitationsAcceptPOST(acceptReq(), tokenCtx());
    expect(res.status).toBe(410);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('token_revoked');
    expect(json.error.code).not.toBe('gone');
  });

  it('invalid token → 404 with envelope code "not_found"', async () => {
    state.rpcAcceptError = { message: 'token_invalid' };
    const res = await InvitationsAcceptPOST(acceptReq(), tokenCtx());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('not_found');
  });

  it('concurrent accept of same pending token: exactly one succeeds, other 409 token_used', async () => {
    // Use a unique user to avoid collisions with the rate-limit bucket from
    // earlier tests in this describe block.
    const uniqueUser = '00000000-0000-4000-8000-0000000000c2';
    state.userId = uniqueUser;
    resetKey(`inv-accept:${uniqueUser}`);
    state.concurrencyMode = true;
    const [r1, r2] = await Promise.all([
      InvitationsAcceptPOST(acceptReq(), tokenCtx()),
      InvitationsAcceptPOST(acceptReq(), tokenCtx()),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const conflictRes = r1.status === 409 ? r1 : r2;
    const json = (await conflictRes.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/already used/i);
    resetKey(`inv-accept:${uniqueUser}`);
  });

  it('idempotent re-accept by same user: success, role preserved (RPC contract)', async () => {
    // The RPC's contract: same user re-accepting returns existing role unchanged.
    // Simulate: user already has owner role; the invite was for editor.
    state.rpcAcceptRow = { trip_id: FIXED_TRIP_ID, role: 'owner' };
    const res = await InvitationsAcceptPOST(acceptReq(), tokenCtx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { role: string };
    // Role returned is the existing membership role, not the invitation role.
    expect(json.role).toBe('owner');
  });
});
