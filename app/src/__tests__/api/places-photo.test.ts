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
  cached_details: Record<string, unknown> | null;
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

const getPhotoMock = vi.fn();
vi.mock('@/lib/google/places', () => ({
  getPhoto: (ref: string, w: number) => getPhotoMock(ref, w),
}));

import { GET } from '@/app/api/places/[googlePlaceId]/photo/[photoRef]/route';
import { resetKey } from '@/lib/rate-limit';

const VALID_PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
const VALID_PHOTO_REF = 'places/abc/photos/p1';

function withCachedPhoto(refs: string[]): CacheRow {
  return {
    cached_details: {
      rating: 4.5,
      user_ratings_total: 10,
      phone: null,
      website: null,
      opening_hours: null,
      photos: refs.map((r) => ({
        photo_reference: r,
        width: 1024,
        height: 768,
        attributions: [],
      })),
      google_maps_url: null,
    },
  };
}

function makeStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff, 0xd8, 0xff]));
      controller.close();
    },
  });
}

function mkReq(
  placeId: string,
  ref: string,
  qs = '?maxWidth=800',
): { req: NextRequest; ctx: { params: Promise<{ googlePlaceId: string; photoRef: string }> } } {
  const enc = encodeURIComponent(ref);
  const req = new NextRequest(
    `http://localhost/api/places/${placeId}/photo/${enc}${qs}`,
    { method: 'GET' },
  );
  return {
    req,
    ctx: {
      params: Promise.resolve({ googlePlaceId: placeId, photoRef: enc }),
    },
  };
}

beforeEach(() => {
  authedUserId = FIXED_USER_ID;
  auditCalls.length = 0;
  cacheRow = withCachedPhoto([VALID_PHOTO_REF]);
  cacheError = null;
  getPhotoMock.mockReset();
  getPhotoMock.mockResolvedValue({
    contentType: 'image/jpeg',
    body: makeStream(),
  });
  resetKey(`places:photo:user:${FIXED_USER_ID}`);
});

afterEach(() => {
  resetKey(`places:photo:user:${FIXED_USER_ID}`);
});

describe('GET /api/places/[id]/photo/[ref] — auth & validation', () => {
  it('401 when no session', async () => {
    authedUserId = null;
    const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF);
    const res = await GET(req, ctx);
    expect(res.status).toBe(401);
  });

  it('400 invalid_place_id when placeId malformed', async () => {
    const { req, ctx } = mkReq('bad!!', VALID_PHOTO_REF);
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid_place_id');
  });

  it('400 when maxWidth not in allowlist (e.g. 999)', async () => {
    const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF, '?maxWidth=999');
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('400 when maxWidth is non-numeric garbage', async () => {
    const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF, '?maxWidth=abc');
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
  });

  it('400 when photoRef contains traversal segment "..", even when allowlisted', async () => {
    cacheRow = withCachedPhoto(['places/abc/../secret/p1']);
    const { req, ctx } = mkReq(VALID_PLACE_ID, 'places/abc/../secret/p1');
    const res = await GET(req, ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('404 when photoRef is not in cached_details.photos', async () => {
    cacheRow = withCachedPhoto(['places/abc/photos/other']);
    const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF);
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('404 when no cache row exists', async () => {
    cacheRow = null;
    const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF);
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/places/[id]/photo/[ref] — rate limit', () => {
  it('429 on the 61st call within window', async () => {
    cacheRow = withCachedPhoto([VALID_PHOTO_REF]);
    let last = 0;
    for (let i = 0; i < 60; i++) {
      const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF);
      const r = await GET(req, ctx);
      last = r.status;
    }
    expect(last).toBe(200);
    const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF);
    const blocked = await GET(req, ctx);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });
});

describe('GET /api/places/[id]/photo/[ref] — success', () => {
  it('streams body with correct Content-Type, Cache-Control private, X-Content-Type-Options', async () => {
    getPhotoMock.mockResolvedValueOnce({
      contentType: 'image/png',
      body: makeStream(),
    });
    const { req, ctx } = mkReq(VALID_PLACE_ID, VALID_PHOTO_REF, '?maxWidth=400');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toContain('private');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    // Audit emitted with max_width metadata.
    const evt = auditCalls.find((c) => c.action === 'place_photo_proxied');
    expect(evt).toBeDefined();
    expect((evt!.metadata as Record<string, unknown>).max_width).toBe(400);
    // Body actually streams something.
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
