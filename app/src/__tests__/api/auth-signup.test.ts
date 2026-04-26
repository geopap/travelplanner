import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (p: Record<string, unknown>) => {
    auditCalls.push(p);
  },
}));

// ---- Controllable service-client behaviour ---------------------------------
type RpcResult = { data: unknown; error: { message: string } | null };
let lookupResult: RpcResult = {
  data: [
    {
      status: 'pending',
      trip_id: 'trip-1',
      trip_name: 'Test Trip',
      inviter_name: 'Owner',
      email: 'user@example.com',
      role: 'editor',
      expires_at: '2099-01-01T00:00:00Z',
    },
  ],
  error: null,
};
let consumeResult: RpcResult = {
  data: [{ trip_id: 'trip-1', role: 'editor' }],
  error: null,
};
let createUserResult: {
  data: { user: { id: string } | null };
  error: { message: string; status?: number } | null;
} = {
  data: { user: { id: 'new-user-id' } },
  error: null,
};
let deleteUserResult: { error: { message: string } | null } = { error: null };
let deleteUserCallCount = 0;
let deleteUserResults: Array<{ error: { message: string } | null }> | null = null;
let updateUserResult: { error: { message: string } | null } = { error: null };
let updateUserCalls: Array<{
  userId: string;
  attrs: Record<string, unknown>;
}> = [];
const consumeRpcCalls: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'get_invitation_by_token') return lookupResult;
      if (name === 'signup_consume_invitation') {
        consumeRpcCalls.push(args ?? {});
        return consumeResult;
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
    auth: {
      admin: {
        createUser: async () => createUserResult,
        deleteUser: async () => {
          const idx = deleteUserCallCount++;
          if (deleteUserResults) {
            return (
              deleteUserResults[idx] ??
              deleteUserResults[deleteUserResults.length - 1] ?? { error: null }
            );
          }
          return deleteUserResult;
        },
        updateUserById: async (
          userId: string,
          attrs: Record<string, unknown>,
        ) => {
          updateUserCalls.push({ userId, attrs });
          return updateUserResult;
        },
      },
    },
  }),
}));

import {
  POST,
  isDuplicateEmailError,
} from '@/app/api/auth/signup/route';

const VALID_TOKEN = 'A'.repeat(43);

function mkReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const valid = {
  email: 'user@example.com',
  password: 'Str0ngPassword!',
  confirm_password: 'Str0ngPassword!',
  invite_token: VALID_TOKEN,
};

beforeEach(() => {
  auditCalls.length = 0;
  lookupResult = {
    data: [
      {
        status: 'pending',
        trip_id: 'trip-1',
        trip_name: 'Test Trip',
        inviter_name: 'Owner',
        email: 'user@example.com',
        role: 'editor',
        expires_at: '2099-01-01T00:00:00Z',
      },
    ],
    error: null,
  };
  consumeResult = { data: [{ trip_id: 'trip-1', role: 'editor' }], error: null };
  createUserResult = { data: { user: { id: 'new-user-id' } }, error: null };
  deleteUserResult = { error: null };
  deleteUserCallCount = 0;
  deleteUserResults = null;
  updateUserResult = { error: null };
  updateUserCalls = [];
  consumeRpcCalls.length = 0;
});

describe('POST /api/auth/signup — invitation-gated', () => {
  it('returns {ok:true} on successful invitation-gated signup', async () => {
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const completed = auditCalls.find((a) => a.action === 'signup_completed');
    expect(completed).toBeDefined();
    // Audit metadata contract: email_hash + trip_id + role; no raw email.
    const meta = completed?.metadata as Record<string, unknown>;
    expect(meta.trip_id).toBe('trip-1');
    expect(meta.role).toBe('editor');
    expect(typeof meta.email_hash).toBe('string');
    expect((meta.email_hash as string).length).toBeGreaterThan(10);
    // entityId set to new auth user id; tripId mirrored at top level.
    expect(completed?.entityId).toBe('new-user-id');
    expect(completed?.tripId).toBe('trip-1');
    // Happy path: createUser was called and consume RPC ran exactly once.
    expect(consumeRpcCalls.length).toBe(1);
    expect(consumeRpcCalls[0]?.p_user_id).toBe('new-user-id');
  });

  it('does NOT call createUser when invitation pre-flight rejects (expired/used/revoked/mismatch)', async () => {
    // Spy via state: createUserResult should remain "not consumed" because we
    // bail at the pre-flight stage. We assert by counting consume RPC calls
    // (which only happen post-createUser on the success path or as the timing
    // pad on duplicate-email — neither applies here).
    const cases: Array<{ status: string; code: string }> = [
      { status: 'expired', code: 'invite_expired' },
      { status: 'used', code: 'invite_used' },
      { status: 'revoked', code: 'invite_revoked' },
    ];
    for (const c of cases) {
      consumeRpcCalls.length = 0;
      auditCalls.length = 0;
      lookupResult = { data: [{ status: c.status }], error: null };
      const res = await POST(
        mkReq(valid, { 'x-forwarded-for': `2.1.1.7${c.status[0]}` }),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe(c.code);
      // No consume RPC ⇒ implies createUser was not called either (route
      // bails before createUser).
      expect(consumeRpcCalls.length).toBe(0);
      // signup_rejected emitted with email_hash; no raw email leak.
      const rej = auditCalls.find((a) => a.action === 'signup_rejected');
      expect(rej).toBeDefined();
      const meta = rej?.metadata as Record<string, unknown>;
      expect(typeof meta.email_hash).toBe('string');
    }
  });

  it('concurrent signups on the same token: second attempt is rejected as invite_used', async () => {
    // First call: success path.
    const r1 = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.60' }));
    expect(r1.status).toBe(200);

    // Second call simulates the race: pre-flight still sees 'pending' (the
    // first transaction has not yet flipped status in this mock), but the RPC
    // raises token_used because FOR UPDATE serialised the second consumer.
    consumeResult = { data: null, error: { message: 'token_used' } };
    const r2 = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.61' }));
    expect(r2.status).toBe(403);
    const body = (await r2.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invite_used');
    // Compensation deletion ran to remove the orphan auth user from r2.
    expect(deleteUserCallCount).toBeGreaterThanOrEqual(1);
  });

  it('happy path does NOT emit signup_compensation_failed', async () => {
    await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.62' }));
    expect(
      auditCalls.find((a) => a.action === 'signup_compensation_failed'),
    ).toBeUndefined();
    expect(
      auditCalls.find((a) => a.action === 'signup_orphan_unflagged'),
    ).toBeUndefined();
  });

  it('returns identical {ok:true} when email already exists (anti-enumeration)', async () => {
    createUserResult = {
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.2' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rejected = auditCalls.find((a) => a.action === 'signup_rejected');
    expect(rejected).toBeDefined();
    expect((rejected?.metadata as Record<string, unknown>).reason).toBe(
      'duplicate_email',
    );
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await POST(mkReq('not-json', { 'x-forwarded-for': '2.1.1.3' }));
    expect(res.status).toBe(400);
  });

  it('rejects schema-invalid payload (missing invite_token) with 400', async () => {
    const res = await POST(
      mkReq(
        { email: 'a@b.co', password: 'Str0ngPassword!', confirm_password: 'Str0ngPassword!' },
        { 'x-forwarded-for': '2.1.1.4' },
      ),
    );
    expect(res.status).toBe(400);
  });

  it('rejects expired invitation with 403 invite_expired', async () => {
    lookupResult = { data: [{ status: 'expired' }], error: null };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.5' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invite_expired');
  });

  it('rejects used invitation with 403 invite_used', async () => {
    lookupResult = { data: [{ status: 'used' }], error: null };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.6' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invite_used');
  });

  it('rejects revoked invitation with 403 invite_revoked', async () => {
    lookupResult = { data: [{ status: 'revoked' }], error: null };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.7' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invite_revoked');
  });

  it('rejects unknown invitation with 403 invite_invalid', async () => {
    lookupResult = { data: [{ status: 'invalid' }], error: null };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.8' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invite_invalid');
  });

  it('rejects email mismatch with 403 invite_email_mismatch', async () => {
    lookupResult = {
      data: [
        {
          status: 'pending',
          trip_id: 'trip-1',
          trip_name: 'T',
          inviter_name: 'O',
          email: 'someoneelse@example.com',
          role: 'editor',
          expires_at: '2099-01-01T00:00:00Z',
        },
      ],
      error: null,
    };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.9' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invite_email_mismatch');
  });

  it('compensates by deleting auth user when consume RPC fails', async () => {
    consumeResult = { data: null, error: { message: 'token_used' } };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.10' }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invite_used');
  });

  it('audits signup_compensation_failed and returns 503 when delete fails after RPC error', async () => {
    consumeResult = { data: null, error: { message: 'token_expired' } };
    deleteUserResult = { error: { message: 'boom' } };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.11' }));
    expect(res.status).toBe(503);
    expect(
      auditCalls.find((a) => a.action === 'signup_compensation_failed'),
    ).toBeDefined();
  });

  it('rate-limits at 10/IP/15min', async () => {
    const ip = '2.1.1.200';
    for (let i = 0; i < 10; i++) {
      const r = await POST(mkReq(valid, { 'x-forwarded-for': ip }));
      expect(r.status).toBe(200);
    }
    const eleventh = await POST(mkReq(valid, { 'x-forwarded-for': ip }));
    expect(eleventh.status).toBe(429);
  });

  it('timing pad: duplicate-email path invokes signup_consume_invitation with sentinel', async () => {
    createUserResult = {
      data: { user: null },
      error: { message: 'User already registered', status: 422 },
    };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.50' }));
    expect(res.status).toBe(200);
    // Pad RPC was called with sentinel email
    expect(consumeRpcCalls.length).toBe(1);
    expect(consumeRpcCalls[0]?.p_email).toBe('__pad__@example.invalid');
  });

  it('compensation: retries deleteUser up to 3 times then flags orphan via app_metadata', async () => {
    consumeResult = { data: null, error: { message: 'token_used' } };
    deleteUserResults = [
      { error: { message: 'transient-1' } },
      { error: { message: 'transient-2' } },
      { error: { message: 'transient-3' } },
    ];
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.51' }));
    expect(res.status).toBe(503);
    expect(deleteUserCallCount).toBe(3);
    // Orphan flag was set
    expect(updateUserCalls.length).toBe(1);
    expect(updateUserCalls[0]?.userId).toBe('new-user-id');
    const meta = updateUserCalls[0]?.attrs.app_metadata as Record<
      string,
      unknown
    >;
    expect(meta.signup_orphan).toBe(true);
    expect(typeof meta.orphaned_at).toBe('string');
    // Audits include compensation_failed with attempts:3
    const compFailed = auditCalls.find(
      (a) => a.action === 'signup_compensation_failed',
    );
    expect(compFailed).toBeDefined();
    expect(
      (compFailed?.metadata as Record<string, unknown>).attempts,
    ).toBe(3);
  });

  it('compensation: emits SEV3 signup_orphan_unflagged when updateUserById also fails', async () => {
    consumeResult = { data: null, error: { message: 'token_used' } };
    deleteUserResults = [
      { error: { message: 'x' } },
      { error: { message: 'x' } },
      { error: { message: 'x' } },
    ];
    updateUserResult = { error: { message: 'flag-failed' } };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.52' }));
    expect(res.status).toBe(503);
    const sev3 = auditCalls.find(
      (a) => a.action === 'signup_orphan_unflagged',
    );
    expect(sev3).toBeDefined();
    expect((sev3?.metadata as Record<string, unknown>).severity).toBe('SEV3');
  });

  it('isDuplicateEmailError: structured field detection', () => {
    expect(isDuplicateEmailError(null)).toBe(false);
    expect(isDuplicateEmailError(undefined)).toBe(false);
    // Preferred: explicit code
    expect(
      isDuplicateEmailError({ code: 'email_exists', status: 422 }),
    ).toBe(true);
    // 422 with non-email code is some other validation error
    expect(
      isDuplicateEmailError({
        code: 'weak_password',
        status: 422,
        message: 'Password too short',
      }),
    ).toBe(false);
    // 422 alone (no code) → treat as duplicate (older GoTrue)
    expect(isDuplicateEmailError({ status: 422 })).toBe(true);
    // Fallback: message regex when no status/code
    expect(
      isDuplicateEmailError({ message: 'User already registered' }),
    ).toBe(true);
    expect(
      isDuplicateEmailError({ message: 'something else' }),
    ).toBe(false);
  });

  it('does not log raw email in audit metadata', async () => {
    await POST(mkReq(valid, { 'x-forwarded-for': '2.1.1.12' }));
    for (const entry of auditCalls) {
      const meta = JSON.stringify(entry.metadata ?? {});
      expect(meta.includes('user@example.com')).toBe(false);
    }
  });
});
