// @vitest-environment jsdom
//
// B-045 — Tests for the client-side fetch wrapper at
// app/src/lib/fetch/api-client.ts. The wrapper:
//   - intercepts 401s with { error: { code: 'session_expired' } } and
//     redirects via window.location.assign + throws SessionExpiredError;
//   - passes every other response through untouched;
//   - is SSR-safe: when window is undefined, it returns the response without
//     side effects.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  // Pin a deterministic location so the redirect URL is reproducible.
  // jsdom does not let us assign to window.location.assign directly via
  // assignment in some versions, so we redefine the property.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      pathname: '/trips/abc',
      search: '?tab=plan',
      assign: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiFetch (client wrapper) — B-045', () => {
  it('Case A: passes 200 OK responses through unchanged so callers can .json()', async () => {
    const payload = { hello: 'world' };
    const fetchSpy = vi.fn(async () => jsonResponse(200, payload));
    vi.stubGlobal('fetch', fetchSpy);

    const { apiFetch } = await import('@/lib/fetch/api-client');
    const res = await apiFetch('/api/whatever');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { hello: string };
    expect(json.hello).toBe('world');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      (window.location as unknown as { assign: ReturnType<typeof vi.fn> }).assign,
    ).not.toHaveBeenCalled();
  });

  it('Case B: on 401 session_expired, calls window.location.assign with /sign-in?redirect=<here> and throws SessionExpiredError', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(401, { error: { code: 'session_expired' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const mod = await import('@/lib/fetch/api-client');
    await expect(mod.apiFetch('/api/trips')).rejects.toBeInstanceOf(
      mod.SessionExpiredError,
    );

    const assign = (window.location as unknown as { assign: ReturnType<typeof vi.fn> })
      .assign;
    expect(assign).toHaveBeenCalledTimes(1);
    const target = assign.mock.calls[0][0] as string;
    expect(target.startsWith('/sign-in?redirect=')).toBe(true);
    // The redirect param should be the URL-encoded current location.
    expect(target).toContain(encodeURIComponent('/trips/abc?tab=plan'));
    // The sign-in page shows an amber "session expired" banner for this notice.
    expect(target).toContain('&notice=session_expired');
  });

  it('Case C: on a non-session_expired 401, passes the response through untouched (no redirect)', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(401, { error: { code: 'unauthorized' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { apiFetch } = await import('@/lib/fetch/api-client');
    const res = await apiFetch('/api/private');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(
      (window.location as unknown as { assign: ReturnType<typeof vi.fn> }).assign,
    ).not.toHaveBeenCalled();
  });

  it('Case D: SSR safety — when window is undefined, the wrapper returns the response without throwing or redirecting', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(401, { error: { code: 'session_expired' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    // Simulate Node SSR by removing the window global. vi.stubGlobal is the
    // documented way to swap a global for the duration of the test.
    vi.stubGlobal('window', undefined);

    const { apiFetch } = await import('@/lib/fetch/api-client');
    const res = await apiFetch('/api/anything');
    expect(res.status).toBe(401);
    // No throw, no redirect — the response is returned as-is. Caller can
    // .clone().json() it to inspect.
    const body = (await res.clone().json()) as { error: { code: string } };
    expect(body.error.code).toBe('session_expired');
  });

  it('passes a non-401 response through even when the body coincidentally has session_expired code', async () => {
    // Defensive: the wrapper must only intercept on status === 401.
    const fetchSpy = vi.fn(async () =>
      jsonResponse(500, { error: { code: 'session_expired' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const { apiFetch } = await import('@/lib/fetch/api-client');
    const res = await apiFetch('/api/x');
    expect(res.status).toBe(500);
    expect(
      (window.location as unknown as { assign: ReturnType<typeof vi.fn> }).assign,
    ).not.toHaveBeenCalled();
  });
});
