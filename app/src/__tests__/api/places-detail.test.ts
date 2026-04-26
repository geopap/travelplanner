import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID } from '../factories';

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (params: Record<string, unknown>) => {
    auditCalls.push(params);
  },
}));

interface CacheRow {
  google_place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  category: string;
  cached_details: Record<string, unknown> | null;
  cached_at: string | null;
}

let authedUserId: string | null = FIXED_USER_ID;
let cacheRow: CacheRow | null = null;
let cacheError: { message: string } | null = null;

function mockSupabase() {
  return {
    from(table: string) {
      if (table !== 'places') {
        throw new Error(`unexpected table: ${table}`);
      }
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          return { data: cacheError ? null : cacheRow, error: cacheError };
        },
      };
      return builder;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  requireAuth: async () =>
    authedUserId
      ? { user: { id: authedUserId }, supabase: mockSupabase() }
      : null,
}));

const upsertCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({
    from() {
      return {
        upsert: (rows: Record<string, unknown>) => {
          upsertCalls.push(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

const getPlaceDetailsMock = vi.fn();
vi.mock('@/lib/google/places', () => {
  class PlaceNotFoundError extends Error {
    constructor(id: string) {
      super(`place_not_found:${id}`);
      this.name = 'PlaceNotFoundError';
    }
  }
  return {
    getPlaceDetails: (id: string) => getPlaceDetailsMock(id),
    PlaceNotFoundError,
  };
});

// Test-local holder for synthesizing the rejection — the route checks
// `instanceof` against the mocked module's class, so we re-import it lazily.
const mockedRefs: { PNF: (new (id: string) => Error) | null } = { PNF: null };

import { GET } from '@/app/api/places/[googlePlaceId]/route';
import { resetKey } from '@/lib/rate-limit';
import { PlaceNotFoundError as ImportedPNF } from '@/lib/google/places';
mockedRefs.PNF = ImportedPNF;

const VALID_PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

function freshCachedDetails(): Record<string, unknown> {
  return {
    rating: 4.5,
    user_ratings_total: 1234,
    phone: '+81 3-1234-5678',
    website: 'https://example.com/place',
    opening_hours: {
      periods: [],
      weekday_text: ['Mon: 9–17'],
    },
    photos: [
      {
        photo_reference: 'places/abc/photos/p1',
        width: 1024,
        height: 768,
        attributions: [],
      },
    ],
    google_maps_url: 'https://maps.google.com/?cid=1',
  };
}

function freshGoogleDetail(): Record<string, unknown> {
  return {
    google_place_id: VALID_PLACE_ID,
    name: 'Tokyo Tower',
    formatted_address: '4 Chome-2-8 Shibakoen, Tokyo',
    lat: 35.6586,
    lng: 139.7454,
    category: 'sight',
    rating: 4.5,
    user_ratings_total: 1234,
    phone: '+81 3-1234-5678',
    website: 'https://example.com/place',
    opening_hours: { periods: [], weekday_text: [] },
    photos: [
      {
        photo_reference: 'places/abc/photos/p1',
        width: 1024,
        height: 768,
        attributions: [],
      },
    ],
    google_maps_url: 'https://maps.google.com/?cid=1',
    source: 'google',
    cached_at: null,
  };
}

beforeEach(() => {
  authedUserId = FIXED_USER_ID;
  auditCalls.length = 0;
  upsertCalls.length = 0;
  cacheRow = null;
  cacheError = null;
  getPlaceDetailsMock.mockReset();
  resetKey(`places:details:user:${FIXED_USER_ID}`);
});

afterEach(() => {
  resetKey(`places:details:user:${FIXED_USER_ID}`);
});

async function callRoute(reqUrlPlaceId = VALID_PLACE_ID): Promise<Response> {
  const req = new NextRequest(
    `http://localhost/api/places/${reqUrlPlaceId}`,
    { method: 'GET' },
  );
  return GET(req, {
    params: Promise.resolve({ googlePlaceId: reqUrlPlaceId }),
  });
}

describe('GET /api/places/[id] — auth & validation', () => {
  it('401 when no session', async () => {
    authedUserId = null;
    const res = await callRoute();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('400 invalid_place_id when id contains illegal chars', async () => {
    const res = await callRoute('bad id!!');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_place_id');
  });

  it('400 invalid_place_id when id too short', async () => {
    const res = await callRoute('abc');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_place_id');
  });
});

describe('GET /api/places/[id] — rate limit', () => {
  it('429 with Retry-After on the 31st call within window', async () => {
    cacheRow = {
      google_place_id: VALID_PLACE_ID,
      name: 'Tokyo Tower',
      formatted_address: 'addr',
      lat: 35.6,
      lng: 139.7,
      category: 'sight',
      cached_details: freshCachedDetails(),
      cached_at: new Date().toISOString(),
    };
    let last = 0;
    for (let i = 0; i < 30; i++) {
      const r = await callRoute();
      last = r.status;
    }
    expect(last).toBe(200);
    const blocked = await callRoute();
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: { code: string; details: { retry_after: number } };
    };
    expect(body.error.code).toBe('rate_limit_exceeded');
    expect(body.error.details.retry_after).toBeGreaterThan(0);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });
});

describe('GET /api/places/[id] — cache hit', () => {
  it('returns source=cache and does not call Google when row is fresh + valid', async () => {
    cacheRow = {
      google_place_id: VALID_PLACE_ID,
      name: 'Tokyo Tower',
      formatted_address: 'addr',
      lat: 35.6,
      lng: 139.7,
      category: 'sight',
      cached_details: freshCachedDetails(),
      cached_at: new Date().toISOString(),
    };
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('cache');
    expect(getPlaceDetailsMock).not.toHaveBeenCalled();
    const evt = auditCalls.find((c) => c.action === 'place_details_fetched');
    expect(evt).toBeDefined();
    expect((evt!.metadata as Record<string, unknown>).source).toBe('cache');
  });
});

describe('GET /api/places/[id] — cache miss / refresh paths', () => {
  it('cache miss → calls Google and returns source=google + audits', async () => {
    cacheRow = null;
    getPlaceDetailsMock.mockResolvedValueOnce(freshGoogleDetail());
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; cached_at: string };
    expect(body.source).toBe('google');
    expect(body.cached_at).toBeTruthy();
    expect(getPlaceDetailsMock).toHaveBeenCalledWith(VALID_PLACE_ID);
    expect(upsertCalls).toHaveLength(1);
    const evt = auditCalls.find((c) => c.action === 'place_details_fetched');
    expect(evt).toBeDefined();
    expect((evt!.metadata as Record<string, unknown>).source).toBe('google');
  });

  it('stale cached_at (>7d) → refetches from Google', async () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    cacheRow = {
      google_place_id: VALID_PLACE_ID,
      name: 'Tokyo Tower',
      formatted_address: 'addr',
      lat: 35.6,
      lng: 139.7,
      category: 'sight',
      cached_details: freshCachedDetails(),
      cached_at: eightDaysAgo,
    };
    getPlaceDetailsMock.mockResolvedValueOnce(freshGoogleDetail());
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('google');
    expect(getPlaceDetailsMock).toHaveBeenCalled();
  });

  it('corrupt cached_details (Zod fail) → refetches from Google', async () => {
    cacheRow = {
      google_place_id: VALID_PLACE_ID,
      name: 'Tokyo Tower',
      formatted_address: 'addr',
      lat: 35.6,
      lng: 139.7,
      category: 'sight',
      // Missing required fields → PlaceDetailCachedSchema fails.
      cached_details: { rating: 'not-a-number' },
      cached_at: new Date().toISOString(),
    };
    getPlaceDetailsMock.mockResolvedValueOnce(freshGoogleDetail());
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('google');
    expect(getPlaceDetailsMock).toHaveBeenCalled();
  });

  it('slim row name > 256 chars → triggers refetch from Google', async () => {
    cacheRow = {
      google_place_id: VALID_PLACE_ID,
      name: 'x'.repeat(300),
      formatted_address: 'addr',
      lat: 35.6,
      lng: 139.7,
      category: 'sight',
      cached_details: freshCachedDetails(),
      cached_at: new Date().toISOString(),
    };
    getPlaceDetailsMock.mockResolvedValueOnce(freshGoogleDetail());
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('google');
  });

  it('slim row lat out of range → triggers refetch from Google', async () => {
    cacheRow = {
      google_place_id: VALID_PLACE_ID,
      name: 'Tokyo Tower',
      formatted_address: 'addr',
      lat: 999,
      lng: 139.7,
      category: 'sight',
      cached_details: freshCachedDetails(),
      cached_at: new Date().toISOString(),
    };
    getPlaceDetailsMock.mockResolvedValueOnce(freshGoogleDetail());
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('google');
  });
});

describe('GET /api/places/[id] — Google failure paths', () => {
  it('404 place_not_found when Google returns 404', async () => {
    cacheRow = null;
    const PNF = mockedRefs.PNF!;
    getPlaceDetailsMock.mockRejectedValueOnce(new PNF(VALID_PLACE_ID));
    const res = await callRoute();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('place_not_found');
  });

  it('502 places_unavailable on Google 5xx / network error', async () => {
    cacheRow = null;
    getPlaceDetailsMock.mockRejectedValueOnce(new Error('places_http_503'));
    const res = await callRoute();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('places_unavailable');
  });
});
