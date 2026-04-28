/**
 * Unit tests for the active-session eviction interceptor (B-013 AC-9).
 *
 * Covers:
 *   - parseTripScopedPath() correctly identifies trip-scoped paths
 *   - apiFetch dispatches EVICTION_EVENT on 403 not_a_member for trip-scoped paths
 *   - 403 with other codes does NOT dispatch
 *   - Non-trip-scoped 403 not_a_member does NOT dispatch
 *   - Successful responses do NOT dispatch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EVICTION_EVENT,
  parseTripScopedPath,
} from '@/lib/utils/eviction';

const TRIP_ID = '00000000-0000-4000-8000-000000000010';

describe('parseTripScopedPath', () => {
  it('extracts trip id from a trip-scoped path', () => {
    expect(parseTripScopedPath(`/api/trips/${TRIP_ID}/items`)).toBe(TRIP_ID);
  });
  it('extracts trip id from a path with query string', () => {
    expect(
      parseTripScopedPath(`/api/trips/${TRIP_ID}/members?page=1`),
    ).toBe(TRIP_ID);
  });
  it('extracts trip id from a fully-qualified URL', () => {
    expect(
      parseTripScopedPath(`http://localhost/api/trips/${TRIP_ID}/days/abc`),
    ).toBe(TRIP_ID);
  });
  it('returns null for the bare /api/trips collection', () => {
    expect(parseTripScopedPath('/api/trips')).toBeNull();
  });
  it('returns null for a non-trip-scoped path', () => {
    expect(parseTripScopedPath('/api/auth/sign-in')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// apiFetch interceptor — install a fake window + fetch, then exercise.
// ---------------------------------------------------------------------------

interface FakeWindow {
  dispatchEvent: (e: Event) => boolean;
}

let received: Array<{ type: string; detail: unknown }> = [];

function installFakeWindow(): FakeWindow {
  const fake: FakeWindow = {
    dispatchEvent(event: Event) {
      // CustomEvent typings vary by environment; cast through unknown for the
      // detail payload only.
      const ce = event as unknown as { type: string; detail: unknown };
      received.push({ type: ce.type, detail: ce.detail });
      return true;
    },
  };
  // Vitest is in node env — install a synthetic window.
  (globalThis as unknown as { window: FakeWindow }).window = fake;
  return fake;
}

function uninstallFakeWindow() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
}

function mockFetch(status: number, body: unknown) {
  const text = body == null ? '' : JSON.stringify(body);
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  })) as unknown as typeof fetch;
}

async function importApiFetchFresh() {
  // Re-import to reset the dedup timer between tests.
  vi.resetModules();
  const mod = await import('@/lib/utils/api-client');
  return mod;
}

describe('apiFetch eviction interceptor', () => {
  beforeEach(() => {
    received = [];
    installFakeWindow();
  });
  afterEach(() => {
    uninstallFakeWindow();
    vi.useRealTimers();
  });

  it('dispatches EVICTION_EVENT on 403 not_a_member for trip-scoped path', async () => {
    mockFetch(403, {
      error: { code: 'not_a_member', message: 'You are not a member' },
    });
    const { apiFetch, ApiClientError } = await importApiFetchFresh();
    await expect(
      apiFetch(`/api/trips/${TRIP_ID}/items`),
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe(EVICTION_EVENT);
    const detail = received[0]?.detail as { tripId: string; path: string };
    expect(detail.tripId).toBe(TRIP_ID);
  });

  it('does NOT dispatch on 403 with other code (e.g. forbidden)', async () => {
    mockFetch(403, {
      error: { code: 'forbidden', message: 'Forbidden' },
    });
    const { apiFetch } = await importApiFetchFresh();
    await expect(apiFetch(`/api/trips/${TRIP_ID}/items`)).rejects.toThrow();
    expect(received).toHaveLength(0);
  });

  it('does NOT dispatch on non-trip-scoped 403 not_a_member', async () => {
    mockFetch(403, {
      error: { code: 'not_a_member', message: 'No' },
    });
    const { apiFetch } = await importApiFetchFresh();
    await expect(apiFetch('/api/auth/sign-in')).rejects.toThrow();
    expect(received).toHaveLength(0);
  });

  it('does NOT dispatch on successful response', async () => {
    mockFetch(200, { ok: true });
    const { apiFetch } = await importApiFetchFresh();
    await apiFetch(`/api/trips/${TRIP_ID}/items`);
    expect(received).toHaveLength(0);
  });

  it('coalesces consecutive 403 not_a_member dispatches within dedup window', async () => {
    mockFetch(403, {
      error: { code: 'not_a_member', message: 'No' },
    });
    const { apiFetch } = await importApiFetchFresh();
    await expect(apiFetch(`/api/trips/${TRIP_ID}/items`)).rejects.toThrow();
    await expect(
      apiFetch(`/api/trips/${TRIP_ID}/members`),
    ).rejects.toThrow();
    // Both fail, but only first dispatch within the 1500ms dedup window.
    expect(received).toHaveLength(1);
  });
});
