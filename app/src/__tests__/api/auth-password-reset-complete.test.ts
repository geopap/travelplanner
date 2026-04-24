import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeJwt } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

// Control the supabase-js createClient used inside the route.
interface ScriptedClient {
  getUser: 'ok' | 'err';
  updateUser: 'ok' | 'err';
}
let scripted: ScriptedClient = { getUser: 'ok', updateUser: 'ok' };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () =>
        scripted.getUser === 'ok'
          ? { data: { user: { id: 'reset-user' } }, error: null }
          : { data: { user: null }, error: { message: 'invalid' } },
      updateUser: async () =>
        scripted.updateUser === 'ok'
          ? { data: { user: { id: 'reset-user' } }, error: null }
          : { data: null, error: { message: 'bad' } },
    },
  }),
}));

const adminSignOutCalls: string[] = [];
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    auth: {
      admin: {
        signOut: async (token: string, _scope: string) => {
          adminSignOutCalls.push(token);
          return { error: null };
        },
      },
    },
  }),
}));

import { POST } from '@/app/api/auth/password-reset/complete/route';

function mkReq(body: unknown, ip = '3.0.0.1'): NextRequest {
  return new NextRequest('http://localhost/api/auth/password-reset/complete', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

beforeEach(() => {
  scripted = { getUser: 'ok', updateUser: 'ok' };
  adminSignOutCalls.length = 0;
});

const goodPwd = {
  password: 'Str0ngPassword!',
  confirm_password: 'Str0ngPassword!',
};

const recoveryToken = makeJwt({
  sub: 'reset-user',
  aal: 'aal1',
  amr: [{ method: 'recovery' }],
});

describe('POST /api/auth/password-reset/complete', () => {
  it('accepts a recovery-grade token (aal1 + amr=recovery)', async () => {
    const res = await POST(mkReq({ access_token: recoveryToken, ...goodPwd }));
    expect(res.status).toBe(200);
    expect(adminSignOutCalls).toContain(recoveryToken);
  });

  it('rejects token missing AMR recovery method (regression)', async () => {
    const loginToken = makeJwt({
      sub: 'u',
      aal: 'aal1',
      amr: [{ method: 'password' }],
    });
    const res = await POST(mkReq({ access_token: loginToken, ...goodPwd }));
    expect(res.status).toBe(401);
  });

  it('rejects token with wrong AAL', async () => {
    const token = makeJwt({ sub: 'u', aal: 'aal2', amr: [{ method: 'recovery' }] });
    const res = await POST(mkReq({ access_token: token, ...goodPwd }));
    expect(res.status).toBe(401);
  });

  it('rejects token with missing AMR claim', async () => {
    const token = makeJwt({ sub: 'u', aal: 'aal1' });
    const res = await POST(mkReq({ access_token: token, ...goodPwd }));
    expect(res.status).toBe(401);
  });

  it('rejects malformed JWT shape', async () => {
    const res = await POST(
      mkReq({ access_token: 'aaaaaaaaaaaa.bbbbbbbbbbbb', ...goodPwd }), // 2 segments
    );
    expect(res.status).toBe(401);
  });

  it('rejects when Supabase getUser returns no user', async () => {
    scripted = { getUser: 'err', updateUser: 'ok' };
    const res = await POST(mkReq({ access_token: recoveryToken, ...goodPwd }));
    expect(res.status).toBe(401);
  });

  it('returns 401 if updateUser fails', async () => {
    scripted = { getUser: 'ok', updateUser: 'err' };
    const res = await POST(mkReq({ access_token: recoveryToken, ...goodPwd }));
    expect(res.status).toBe(401);
  });

  it('rejects schema-invalid payload', async () => {
    const res = await POST(
      mkReq({ access_token: 'short', password: 'weak', confirm_password: 'weak' }),
    );
    expect(res.status).toBe(400);
  });
});
