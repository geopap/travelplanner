// B-045 — Unit tests for requireFreshSession.
//
// Mocks only the supabase auth surface used by the guard (getSession +
// refreshSession). The verified User is passed in by the caller — routes
// call getUser() themselves, so the guard never re-verifies. Uses
// vi.useFakeTimers() to make `Date.now()` deterministic.
//
// See app/src/lib/api/auth-guard.ts for the implementation under test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import {
  SESSION_EXPIRY_GRACE_MS,
  requireFreshSession,
} from '@/lib/api/auth-guard';

const FIXED_NOW_MS = 1_700_000_000_000; // 2023-11-14T22:13:20Z — fixed wall clock
const USER: User = { id: 'user-uuid-aaa' } as User;

interface FakeSessionShape {
  user: User;
  expires_at?: number;
}

function mockSession(expiresAtMs: number): Session {
  return {
    user: USER,
    expires_at: Math.floor(expiresAtMs / 1000),
    // The fields below are present on the real Session type but unused by
    // the guard — keep the literal minimal and cast through the shape we
    // actually use.
    access_token: 'fake-access',
    refresh_token: 'fake-refresh',
    token_type: 'bearer',
    expires_in: 3600,
  } as unknown as Session;
}

interface AuthMock {
  getSession: ReturnType<typeof vi.fn>;
  refreshSession: ReturnType<typeof vi.fn>;
}

function makeClient(auth: AuthMock): SupabaseClient {
  return { auth } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW_MS));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('requireFreshSession', () => {
  it('Case A: returns ok when session expires_at is well beyond the grace window (no refresh)', async () => {
    const session = mockSession(FIXED_NOW_MS + 60 * 60 * 1000); // +1h
    const auth: AuthMock = {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(USER.id);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('Case B: refreshes exactly once and returns ok when current session is inside the grace window', async () => {
    // expires_at within grace (e.g. 10s in future, grace is 30s)
    const stale = mockSession(FIXED_NOW_MS + 10_000);
    const fresh = mockSession(FIXED_NOW_MS + 60 * 60 * 1000);
    const auth: AuthMock = {
      getSession: vi.fn(async () => ({ data: { session: stale }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: fresh }, error: null })),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(true);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('Case C: returns not-ok when refreshSession returns an error', async () => {
    const stale = mockSession(FIXED_NOW_MS - 5_000); // already expired
    const auth: AuthMock = {
      getSession: vi.fn(async () => ({ data: { session: stale }, error: null })),
      refreshSession: vi.fn(async () => ({
        data: { session: null },
        error: { name: 'AuthApiError', message: 'refresh_token revoked' },
      })),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(false);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('Case D: returns not-ok when refresh succeeds but new session is still stale', async () => {
    const stale = mockSession(FIXED_NOW_MS - 1000);
    const stillStale = mockSession(FIXED_NOW_MS + SESSION_EXPIRY_GRACE_MS - 5_000);
    const auth: AuthMock = {
      getSession: vi.fn(async () => ({ data: { session: stale }, error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: stillStale }, error: null })),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(false);
  });

  it('Case E: swallows unexpected throws from getSession and returns not-ok', async () => {
    const auth: AuthMock = {
      getSession: vi.fn(async () => {
        throw new Error('network exploded');
      }),
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(false);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('returns not-ok when getSession returns an error', async () => {
    const auth: AuthMock = {
      getSession: vi.fn(async () => ({
        data: { session: null },
        error: { name: 'AuthApiError', message: 'no session' },
      })),
      refreshSession: vi.fn(),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(false);
  });

  it('returns ok with the caller-verified user when no local session is present (ssr quirk after fresh sign-in)', async () => {
    const auth: AuthMock = {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      refreshSession: vi.fn(),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(USER.id);
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });

  it('treats a session with missing expires_at as stale and attempts a refresh', async () => {
    const noExpiry: FakeSessionShape = { user: USER };
    const fresh = mockSession(FIXED_NOW_MS + 3600_000);
    const auth: AuthMock = {
      getSession: vi.fn(async () => ({
        data: { session: noExpiry as unknown as Session },
        error: null,
      })),
      refreshSession: vi.fn(async () => ({ data: { session: fresh }, error: null })),
    };
    const result = await requireFreshSession(makeClient(auth), USER);
    expect(result.ok).toBe(true);
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });
});
