import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `server-only` is a runtime-guard shim; no behavior in tests.
vi.mock('server-only', () => ({}));

// Mock the service-role supabase client used by upsertPlaces.
const upsertSpy = vi.fn<(rows: unknown) => void>();
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from: (_t: string) => ({
      upsert: (rows: unknown, _opts: unknown) => {
        upsertSpy(rows);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

import { searchPlaces } from '@/lib/google/places';

const ORIGINAL_FETCH = globalThis.fetch;

function mkResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  upsertSpy.mockClear();
  vi.useRealTimers();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('searchPlaces — happy path', () => {
  it('parses Google response and preserves nullable fields', async () => {
    const fetchMock = vi.fn(async () =>
      mkResponse({
        places: [
          {
            id: 'g1',
            displayName: { text: 'Tokyo Tower' },
            formattedAddress: '4 Chome-2-8 Shibakoen, Tokyo',
            location: { latitude: 35.6586, longitude: 139.7454 },
            types: ['tourist_attraction'],
          },
          {
            // Missing optional fields → must surface as null, not skipped.
            id: 'g2',
            displayName: { text: 'Mystery Place' },
            // no formattedAddress, no location
            types: [],
          },
        ],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await searchPlaces('tokyo tower');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      google_place_id: 'g1',
      name: 'Tokyo Tower',
      formatted_address: '4 Chome-2-8 Shibakoen, Tokyo',
      lat: 35.6586,
      lng: 139.7454,
      category: 'sight',
    });
    expect(out[1]).toEqual({
      google_place_id: 'g2',
      name: 'Mystery Place',
      formatted_address: null,
      lat: null,
      lng: null,
      category: 'other',
    });
  });

  it('fires fire-and-forget upsert into places table', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({
        places: [
          {
            id: 'g1',
            displayName: { text: 'Cafe X' },
            formattedAddress: 'A',
            location: { latitude: 1, longitude: 2 },
            types: ['cafe'],
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const out = await searchPlaces('cafe');
    expect(out).toHaveLength(1);
    // Allow the void promise chain to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const firstCall = upsertSpy.mock.calls[0] as unknown[];
    const rows = firstCall[0] as Array<Record<string, unknown>>;
    expect(rows[0].google_place_id).toBe('g1');
    expect(rows[0].category).toBe('cafe');
  });

  it('skips upsert when result list is empty', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({ places: [] }),
    ) as unknown as typeof fetch;
    const out = await searchPlaces('nothing here');
    expect(out).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(upsertSpy).not.toHaveBeenCalled();
  });
});

describe('searchPlaces — retry / failure paths', () => {
  it('retries once on 5xx and returns results on second success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mkResponse({}, 503))
      .mockResolvedValueOnce(
        mkResponse({
          places: [
            {
              id: 'g1',
              displayName: { text: 'OK' },
              types: ['restaurant'],
            },
          ],
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await searchPlaces('retry test');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe('restaurant');
  });

  it('throws after retry when both 5xx responses fail', async () => {
    const fetchMock = vi.fn(async () => mkResponse({}, 502));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(searchPlaces('still failing')).rejects.toThrow(
      /places_http_502/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries once on network error, then propagates', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(searchPlaces('flap')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates AbortError-like timeout as a thrown error', async () => {
    // fetchOnce uses AbortController with 5s timeout. Simulate by rejecting
    // with an AbortError on both attempts.
    const abortErr = new DOMException('aborted', 'AbortError');
    const fetchMock = vi.fn(async () => {
      throw abortErr;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(searchPlaces('slow query')).rejects.toThrow();
    // Original attempt + one retry on network/abort error.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws if GOOGLE_PLACES_API_KEY is missing', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(searchPlaces('whatever')).rejects.toThrow(
      /GOOGLE_PLACES_API_KEY/,
    );
  });

  it('throws on invalid JSON body', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ) as unknown as typeof fetch;
    await expect(searchPlaces('garbage')).rejects.toThrow(
      /places_invalid_json/,
    );
  });

  it('skips malformed places entries (missing id or name)', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({
        places: [
          { id: 'ok1', displayName: { text: 'Good' }, types: ['cafe'] },
          { id: 'noname' }, // no displayName → skipped
          { displayName: { text: 'No id' } }, // no id → skipped
          'not-an-object',
        ],
      }),
    ) as unknown as typeof fetch;

    const out = await searchPlaces('mixed');
    expect(out).toHaveLength(1);
    expect(out[0].google_place_id).toBe('ok1');
  });
});
