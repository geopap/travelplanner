import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `server-only` is a runtime-guard shim; no behavior in tests.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      upsert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

import { getPlaceDetails, PlaceNotFoundError } from '@/lib/google/places';

const ORIGINAL_FETCH = globalThis.fetch;
const VALID_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

function mkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mkRawDetail(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: VALID_ID,
    displayName: { text: 'Tokyo Tower' },
    formattedAddress: '4 Chome-2-8 Shibakoen, Tokyo',
    location: { latitude: 35.6586, longitude: 139.7454 },
    types: ['tourist_attraction'],
    rating: 4.5,
    userRatingCount: 1234,
    internationalPhoneNumber: '+81 3-1234-5678',
    websiteUri: 'https://example.com',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    regularOpeningHours: { periods: [], weekdayDescriptions: [] },
    photos: [],
    ...overrides,
  };
}

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('getPlaceDetails — error mapping', () => {
  it('throws PlaceNotFoundError on Google 404', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({ error: 'NOT_FOUND' }, 404),
    ) as unknown as typeof fetch;
    await expect(getPlaceDetails(VALID_ID)).rejects.toBeInstanceOf(
      PlaceNotFoundError,
    );
  });

  it('throws generic error on Google 5xx after retry', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse({}, 502),
    ) as unknown as typeof fetch;
    await expect(getPlaceDetails(VALID_ID)).rejects.toThrow(/places_http_502/);
  });

  it('throws when API key is missing', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    await expect(getPlaceDetails(VALID_ID)).rejects.toThrow(
      /GOOGLE_PLACES_API_KEY/,
    );
  });
});

describe('parsePhoto attribution handling (via getPlaceDetails)', () => {
  it('preserves http(s) author uri', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse(
        mkRawDetail({
          photos: [
            {
              name: 'places/abc/photos/p1',
              widthPx: 1024,
              heightPx: 768,
              authorAttributions: [
                {
                  displayName: 'Alice',
                  uri: 'https://maps.google.com/maps/contrib/123',
                },
              ],
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;
    const out = await getPlaceDetails(VALID_ID);
    expect(out.photos).toHaveLength(1);
    expect(out.photos[0].attributions[0]).toEqual({
      name: 'Alice',
      uri: 'https://maps.google.com/maps/contrib/123',
    });
  });

  it('sets uri to null when author uri uses javascript: scheme but preserves name', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse(
        mkRawDetail({
          photos: [
            {
              name: 'places/abc/photos/p1',
              widthPx: 100,
              heightPx: 100,
              authorAttributions: [
                {
                  displayName: 'Mallory',
                  uri: 'javascript:alert(1)',
                },
              ],
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;
    const out = await getPlaceDetails(VALID_ID);
    expect(out.photos[0].attributions[0]).toEqual({
      name: 'Mallory',
      uri: null,
    });
  });

  it('sets uri to null when author uri is malformed', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse(
        mkRawDetail({
          photos: [
            {
              name: 'places/abc/photos/p1',
              widthPx: 100,
              heightPx: 100,
              authorAttributions: [
                { displayName: 'Bob', uri: 'not a url at all' },
              ],
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;
    const out = await getPlaceDetails(VALID_ID);
    expect(out.photos[0].attributions[0]).toEqual({
      name: 'Bob',
      uri: null,
    });
  });

  it('preserves name when uri is missing entirely', async () => {
    globalThis.fetch = vi.fn(async () =>
      mkResponse(
        mkRawDetail({
          photos: [
            {
              name: 'places/abc/photos/p1',
              widthPx: 100,
              heightPx: 100,
              authorAttributions: [{ displayName: 'Carol' }],
            },
          ],
        }),
      ),
    ) as unknown as typeof fetch;
    const out = await getPlaceDetails(VALID_ID);
    expect(out.photos[0].attributions[0]).toEqual({
      name: 'Carol',
      uri: null,
    });
  });

  it('caps attributions at 8 entries and photos at 10', async () => {
    const tooManyAttribs = Array.from({ length: 12 }, (_, i) => ({
      displayName: `A${i}`,
    }));
    const tooManyPhotos = Array.from({ length: 15 }, (_, i) => ({
      name: `places/abc/photos/p${i}`,
      widthPx: 100,
      heightPx: 100,
      authorAttributions: tooManyAttribs,
    }));
    globalThis.fetch = vi.fn(async () =>
      mkResponse(mkRawDetail({ photos: tooManyPhotos })),
    ) as unknown as typeof fetch;
    const out = await getPlaceDetails(VALID_ID);
    expect(out.photos).toHaveLength(10);
    expect(out.photos[0].attributions).toHaveLength(8);
  });
});
