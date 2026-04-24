import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, FIXED_TRIP_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: async () => undefined,
}));

// Scripted behaviour
let tripNameInDb = 'Japan 2026';
let accessRole: 'owner' | 'editor' | 'viewer' | 'none' = 'owner';

vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async () => {
    if (accessRole === 'none') return { ok: false as const, reason: 'not_found' as const };
    if (accessRole === 'owner') return { ok: true as const, role: 'owner' as const };
    return { ok: false as const, reason: 'forbidden' as const };
  },
}));

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => {
    if (table === 'trips') {
      return { data: { id: FIXED_TRIP_ID, name: tripNameInDb }, error: null };
    }
    return { data: null, error: null };
  };
  chain.delete = () => ({
    eq: () => Promise.resolve({ error: null }),
  });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }) },
    from: (t: string) => makeChain(t),
  }),
}));

import { DELETE } from '@/app/api/trips/[id]/route';

function mkReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/trips/${FIXED_TRIP_ID}`, {
    method: 'DELETE',
    headers,
  });
}

beforeEach(() => {
  tripNameInDb = 'Japan 2026';
  accessRole = 'owner';
});

describe('DELETE /api/trips/[id] — X-Confirm-Name', () => {
  const ctx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };

  it('succeeds with matching name', async () => {
    const res = await DELETE(mkReq({ 'x-confirm-name': 'Japan 2026' }), ctx);
    expect(res.status).toBe(204);
  });

  it('400 when name mismatch', async () => {
    const res = await DELETE(mkReq({ 'x-confirm-name': 'Wrong Name' }), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('name_mismatch');
  });

  it('400 when header missing', async () => {
    const res = await DELETE(mkReq(), ctx);
    expect(res.status).toBe(400);
  });

  it('case-sensitive match', async () => {
    const res = await DELETE(mkReq({ 'x-confirm-name': 'japan 2026' }), ctx);
    expect(res.status).toBe(400);
  });

  it('403 when user is editor (not owner)', async () => {
    accessRole = 'editor';
    const res = await DELETE(mkReq({ 'x-confirm-name': 'Japan 2026' }), ctx);
    expect(res.status).toBe(403);
  });

  it('404 when user is not a member', async () => {
    accessRole = 'none';
    const res = await DELETE(mkReq({ 'x-confirm-name': 'Japan 2026' }), ctx);
    expect(res.status).toBe(404);
  });

  it('404 on invalid UUID in path', async () => {
    const res = await DELETE(
      new NextRequest('http://localhost/api/trips/not-a-uuid', {
        method: 'DELETE',
        headers: { 'x-confirm-name': 'Japan 2026' },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(res.status).toBe(404);
  });
});
