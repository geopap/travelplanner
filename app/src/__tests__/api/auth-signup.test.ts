import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (p: Record<string, unknown>) => {
    auditCalls.push(p);
  },
}));

// Controllable signup behaviour
let signUpResult: { data: { user: { id: string } | null }; error: { message: string } | null } = {
  data: { user: { id: 'new-user-id' } },
  error: null,
};

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signUp: async () => signUpResult,
    },
  }),
}));

import { POST } from '@/app/api/auth/signup/route';

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
};

beforeEach(() => {
  auditCalls.length = 0;
  signUpResult = { data: { user: { id: 'new-user-id' } }, error: null };
});

describe('POST /api/auth/signup — uniform anti-enumeration response', () => {
  it('returns {ok:true} on successful signup', async () => {
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '1.1.1.1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns identical {ok:true} when email already exists', async () => {
    signUpResult = {
      data: { user: null },
      error: { message: 'User already registered' },
    };
    const res = await POST(mkReq(valid, { 'x-forwarded-for': '1.1.1.2' }));
    // MUST NOT leak — same status and body as success case.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects invalid JSON with 400', async () => {
    const res = await POST(mkReq('not-json', { 'x-forwarded-for': '1.1.1.3' }));
    expect(res.status).toBe(400);
  });

  it('rejects schema-invalid payload with 400', async () => {
    const res = await POST(
      mkReq({ email: 'bad', password: 'short', confirm_password: 'short' }, { 'x-forwarded-for': '1.1.1.4' }),
    );
    expect(res.status).toBe(400);
  });

  it('rate-limits at 5/IP/15min', async () => {
    const ip = '1.1.1.200';
    for (let i = 0; i < 5; i++) {
      const r = await POST(mkReq(valid, { 'x-forwarded-for': ip }));
      expect(r.status).toBe(200);
    }
    const sixth = await POST(mkReq(valid, { 'x-forwarded-for': ip }));
    expect(sixth.status).toBe(429);
  });

  it('writes audit with ok=true metadata on success', async () => {
    await POST(mkReq(valid, { 'x-forwarded-for': '1.1.1.50' }));
    const entry = auditCalls.find((a) => a.action === 'signup');
    expect(entry).toBeDefined();
    expect((entry?.metadata as Record<string, unknown>).ok).toBe(true);
  });

  it('writes audit with ok=false metadata on Supabase error (regression)', async () => {
    signUpResult = {
      data: { user: null },
      error: { message: 'User already registered' },
    };
    await POST(mkReq(valid, { 'x-forwarded-for': '1.1.1.51' }));
    const entry = auditCalls.find((a) => a.action === 'signup');
    expect(entry).toBeDefined();
    expect((entry?.metadata as Record<string, unknown>).ok).toBe(false);
  });
});
