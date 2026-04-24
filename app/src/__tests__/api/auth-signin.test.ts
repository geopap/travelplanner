import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

let signInResult: {
  data: { user: { id: string } | null };
  error: { message: string } | null;
} = { data: { user: { id: 'u1' } }, error: null };

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithPassword: async () => signInResult,
    },
  }),
}));

import { POST } from '@/app/api/auth/signin/route';

function mkReq(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const creds = { email: 'user@example.com', password: 'Str0ngPassword!' };

beforeEach(() => {
  signInResult = { data: { user: { id: 'u1' } }, error: null };
});

describe('POST /api/auth/signin', () => {
  it('returns user_id on success', async () => {
    const res = await POST(mkReq(creds, { 'x-forwarded-for': '2.0.0.1' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user_id: string };
    expect(body.user_id).toBe('u1');
  });

  it('returns generic 401 on invalid credentials (no enumeration)', async () => {
    signInResult = { data: { user: null }, error: { message: 'Invalid login credentials' } };
    const res = await POST(mkReq(creds, { 'x-forwarded-for': '2.0.0.2' }));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid_credentials');
    expect(body.error.message).toBe('Email or password incorrect');
  });

  it('locks out after several failed attempts per (IP,email)', async () => {
    signInResult = { data: { user: null }, error: { message: 'bad' } };
    const ip = '2.0.0.10';
    // Each call both consumes a gate slot and records a failure; cap is 5.
    // At least one of the first few returns 401, subsequent ones must 429.
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await POST(mkReq(creds, { 'x-forwarded-for': ip }));
      statuses.push(r.status);
    }
    expect(statuses).toContain(401);
    expect(statuses).toContain(429);
    // Final calls are definitely locked.
    expect(statuses.slice(-3).every((s) => s === 429)).toBe(true);
  });

  it('different email on same IP uses separate bucket', async () => {
    signInResult = { data: { user: null }, error: { message: 'bad' } };
    const ip = '2.0.0.20';
    for (let i = 0; i < 10; i++) {
      await POST(mkReq({ ...creds, email: 'a@example.com' }, { 'x-forwarded-for': ip }));
    }
    // Saturated for a@ on this IP → 429
    const a = await POST(mkReq({ ...creds, email: 'a@example.com' }, { 'x-forwarded-for': ip }));
    expect(a.status).toBe(429);
    // b@ on the same IP still allowed (per-email bucket)
    const b = await POST(mkReq({ ...creds, email: 'b@example.com' }, { 'x-forwarded-for': ip }));
    expect(b.status).toBe(401);
  });

  it('rejects schema-invalid payload with 400', async () => {
    const res = await POST(mkReq({ email: 'bad', password: '' }, { 'x-forwarded-for': '2.0.0.99' }));
    expect(res.status).toBe(400);
  });
});
