import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Controllable auth state for the middleware client.
let authState: 'authed' | 'unauthed' | 'error' = 'authed';

vi.mock('@/lib/supabase/middleware', () => ({
  createSupabaseMiddlewareClient: (request: NextRequest) => ({
    supabase: {
      auth: {
        getUser: async () => {
          if (authState === 'authed') {
            return { data: { user: { id: 'u1' } }, error: null };
          }
          if (authState === 'error') {
            return { data: { user: null }, error: { message: 'invalid' } };
          }
          return { data: { user: null }, error: null };
        },
      },
    },
    response: NextResponse.next({ request: { headers: request.headers } }),
  }),
}));

import { proxy } from '@/proxy';

beforeEach(() => {
  authState = 'authed';
});

function req(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'));
}

describe('proxy (session guard)', () => {
  it('unauthed + API path → JSON 401', async () => {
    authState = 'unauthed';
    const res = await proxy(req('/api/trips'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('unauthed + nested API path → JSON 401', async () => {
    authState = 'unauthed';
    const res = await proxy(req('/api/trips/some-id/items'));
    expect(res.status).toBe(401);
  });

  it('unauthed + page path → 307 redirect to /sign-in with redirect query', async () => {
    authState = 'unauthed';
    const res = await proxy(req('/trips'));
    expect([302, 307, 308]).toContain(res.status);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/sign-in');
    expect(loc).toContain('redirect=%2Ftrips');
  });

  it('unauthed + nested page path preserves redirect target', async () => {
    authState = 'unauthed';
    const res = await proxy(req('/trips/abc/edit'));
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('redirect=%2Ftrips%2Fabc%2Fedit');
  });

  it('auth error treated as unauthed', async () => {
    authState = 'error';
    const res = await proxy(req('/api/trips'));
    expect(res.status).toBe(401);
  });

  it('authed + API path → continues (no redirect)', async () => {
    authState = 'authed';
    const res = await proxy(req('/api/trips'));
    expect(res.status).not.toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });

  it('authed + page path → continues', async () => {
    authState = 'authed';
    const res = await proxy(req('/trips'));
    expect(res.headers.get('location')).toBeNull();
  });
});
