import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  FIXED_USER_ID,
  FIXED_TRIP_ID,
} from '../factories';
import { resetKey } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Mocks: next/headers, audit, trip-access. Real rate-limit module.
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (p: Record<string, unknown>) => {
    auditCalls.push(p);
  },
}));

type AccessRole = 'owner' | 'editor' | 'viewer' | 'none' | 'forbidden-other';
let accessRole: AccessRole = 'editor';

vi.mock('@/lib/trip-access', () => ({
  checkTripAccess: async (
    _sb: unknown,
    _trip: string,
    _user: string,
    required: 'viewer' | 'editor' | 'owner',
  ) => {
    if (accessRole === 'none') return { ok: false, reason: 'not_found' };
    if (accessRole === 'forbidden-other')
      return { ok: false, reason: 'forbidden' };
    const rank: Record<string, number> = { viewer: 1, editor: 2, owner: 3 };
    if (rank[accessRole] < rank[required])
      return { ok: false, reason: 'forbidden' };
    return { ok: true, role: accessRole };
  },
}));

// ---------------------------------------------------------------------------
// Supabase fake. We model the chains the bookmarks routes actually call.
// ---------------------------------------------------------------------------

const FIXED_PLACE_ROW_ID = '00000000-0000-4000-8000-000000000301';
const FIXED_BOOKMARK_ID = '00000000-0000-4000-8000-000000000401';
const OTHER_TRIP_ID = '00000000-0000-4000-8000-000000000099';

interface PlaceLookup {
  data: { id: string; category: string } | null;
  error: { message: string } | null;
}

interface BookmarkExisting {
  data: { id: string; trip_id: string } | null;
  error: { message: string } | null;
}

interface Insert {
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
}

interface ListResult {
  data: Array<Record<string, unknown>>;
  count: number;
  error: { message: string } | null;
  selectCalls: number; // counter — bumped each .select() at chain root
}

interface AuthState {
  user: { id: string } | null;
}

const state: {
  auth: AuthState;
  placeLookup: PlaceLookup;
  bookmarkInsert: Insert;
  bookmarkUpdate: Insert;
  bookmarkExisting: BookmarkExisting;
  list: ListResult;
  capturedInserts: Array<Record<string, unknown>>;
  capturedUpdates: Array<Record<string, unknown>>;
  capturedDeletes: Array<{ id: string; tripId: string }>;
  // List chain assertions
  listFromCalls: number;
} = {
  auth: { user: { id: FIXED_USER_ID } },
  placeLookup: {
    data: { id: FIXED_PLACE_ROW_ID, category: 'cafe' },
    error: null,
  },
  bookmarkInsert: { data: null, error: null },
  bookmarkUpdate: { data: null, error: null },
  bookmarkExisting: {
    data: { id: FIXED_BOOKMARK_ID, trip_id: FIXED_TRIP_ID },
    error: null,
  },
  list: { data: [], count: 0, error: null, selectCalls: 0 },
  capturedInserts: [],
  capturedUpdates: [],
  capturedDeletes: [],
  listFromCalls: 0,
};

function makePlacesChain() {
  // Used only for SELECT id, category by google_place_id.
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => state.placeLookup;
  return chain;
}

function makeBookmarksChain() {
  // Differentiate insert / select-list / select-existing / update / delete via
  // sticky flags on the chain object.
  const chain: {
    _mode?: 'insert' | 'list' | 'existing' | 'update' | 'delete';
    _patch?: Record<string, unknown>;
    _filterId?: string;
    _filterTripId?: string;
    select: (...args: unknown[]) => unknown;
    insert: (payload: Record<string, unknown>) => unknown;
    update: (payload: Record<string, unknown>) => unknown;
    delete: () => unknown;
    eq: (col: string, val: string) => unknown;
    order: () => unknown;
    range: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
    single: () => Promise<unknown>;
  } = {
    select(_cols: unknown, _opts?: unknown) {
      // First select after .from('bookmarks') means a list-or-existing query.
      // After .insert/.update, .select is a returning clause; mode is already set.
      if (chain._mode !== 'insert' && chain._mode !== 'update') {
        chain._mode = 'list';
        state.list.selectCalls += 1;
      }
      return chain;
    },
    insert(payload: Record<string, unknown>) {
      chain._mode = 'insert';
      state.capturedInserts.push(payload);
      return chain;
    },
    update(payload: Record<string, unknown>) {
      chain._mode = 'update';
      chain._patch = payload;
      state.capturedUpdates.push(payload);
      return chain;
    },
    delete() {
      chain._mode = 'delete';
      return chain;
    },
    eq(col: string, val: string) {
      if (col === 'id') chain._filterId = val;
      if (col === 'trip_id') chain._filterTripId = val;
      // Delete terminates after the second .eq() with a thenable.
      if (chain._mode === 'delete' && col === 'trip_id') {
        const id = chain._filterId ?? '';
        const tripId = chain._filterTripId ?? '';
        return Promise.resolve({ error: null }).then((r) => {
          state.capturedDeletes.push({ id, tripId });
          return r;
        });
      }
      return chain;
    },
    order() {
      return chain;
    },
    async range() {
      return {
        data: state.list.data,
        error: state.list.error,
        count: state.list.count,
      };
    },
    async maybeSingle() {
      // Existing-row check on PATCH/DELETE.
      chain._mode = 'existing';
      return state.bookmarkExisting;
    },
    async single() {
      if (chain._mode === 'insert') return state.bookmarkInsert;
      if (chain._mode === 'update') return state.bookmarkUpdate;
      return { data: null, error: null };
    },
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.auth.user } }) },
    from: (table: string) => {
      if (table === 'places') return makePlacesChain();
      if (table === 'bookmarks') {
        state.listFromCalls += 1;
        return makeBookmarksChain();
      }
      // Fallback noop chain
      const noop: Record<string, unknown> = {};
      noop.select = () => noop;
      noop.eq = () => noop;
      noop.order = () => noop;
      noop.range = async () => ({ data: [], error: null, count: 0 });
      noop.maybeSingle = async () => ({ data: null, error: null });
      return noop;
    },
  }),
}));

// ---- Import routes AFTER mocks ----
import { POST as POST_LIST, GET as GET_LIST } from '@/app/api/trips/[id]/bookmarks/route';
import { PATCH, DELETE } from '@/app/api/trips/[id]/bookmarks/[bookmarkId]/route';

const tripCtx = { params: Promise.resolve({ id: FIXED_TRIP_ID }) };
const bookmarkCtx = {
  params: Promise.resolve({ id: FIXED_TRIP_ID, bookmarkId: FIXED_BOOKMARK_ID }),
};

function postReq(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/bookmarks`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

function getReq(qs = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/bookmarks${qs}`,
    { method: 'GET' },
  );
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/bookmarks/${FIXED_BOOKMARK_ID}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  );
}

function deleteReq(): NextRequest {
  return new NextRequest(
    `http://localhost/api/trips/${FIXED_TRIP_ID}/bookmarks/${FIXED_BOOKMARK_ID}`,
    { method: 'DELETE' },
  );
}

function defaultInsertedBookmark(category = 'restaurant'): Record<string, unknown> {
  return {
    id: FIXED_BOOKMARK_ID,
    trip_id: FIXED_TRIP_ID,
    place_id: FIXED_PLACE_ROW_ID,
    category,
    notes: null,
    added_by: FIXED_USER_ID,
    created_at: '2026-04-26T00:00:00Z',
    updated_at: '2026-04-26T00:00:00Z',
    place: {
      name: 'Cafe X',
      formatted_address: '1 Street',
      category: 'cafe',
      lat: 1.0,
      lng: 2.0,
    },
  };
}

beforeEach(() => {
  accessRole = 'editor';
  auditCalls.length = 0;
  state.auth = { user: { id: FIXED_USER_ID } };
  state.placeLookup = {
    data: { id: FIXED_PLACE_ROW_ID, category: 'cafe' },
    error: null,
  };
  state.bookmarkInsert = { data: defaultInsertedBookmark(), error: null };
  state.bookmarkUpdate = { data: defaultInsertedBookmark(), error: null };
  state.bookmarkExisting = {
    data: { id: FIXED_BOOKMARK_ID, trip_id: FIXED_TRIP_ID },
    error: null,
  };
  state.list = { data: [], count: 0, error: null, selectCalls: 0 };
  state.capturedInserts.length = 0;
  state.capturedUpdates.length = 0;
  state.capturedDeletes.length = 0;
  state.listFromCalls = 0;
  // Reset rate-limit bucket for the create key.
  resetKey(`bookmarks:create:user:${FIXED_USER_ID}:trip:${FIXED_TRIP_ID}`);
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('POST /api/trips/[tripId]/bookmarks', () => {
  it('AC1: anon → 401', async () => {
    state.auth = { user: null };
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      tripCtx,
    );
    expect(res.status).toBe(401);
  });

  it('AC2: non-member → 403 (forbidden mapped from forbidden reason)', async () => {
    accessRole = 'forbidden-other';
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      tripCtx,
    );
    expect(res.status).toBe(403);
  });

  it('AC2b: not_found reason → 404', async () => {
    accessRole = 'none';
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      tripCtx,
    );
    expect(res.status).toBe(404);
  });

  it('AC3: viewer → 403', async () => {
    accessRole = 'viewer';
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      tripCtx,
    );
    expect(res.status).toBe(403);
  });

  it('AC4: editor + cached place → 201; default category narrowed from place (cafe→restaurant)', async () => {
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.capturedInserts).toHaveLength(1);
    expect(state.capturedInserts[0].category).toBe('restaurant');
    expect(state.capturedInserts[0].trip_id).toBe(FIXED_TRIP_ID);
    expect(state.capturedInserts[0].added_by).toBe(FIXED_USER_ID);
  });

  it('AC4b: explicit category overrides narrowing', async () => {
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid', category: 'museum' }),
      tripCtx,
    );
    expect(res.status).toBe(201);
    expect(state.capturedInserts[0].category).toBe('museum');
  });

  it('AC5: uncached google_place_id → 404 place_not_cached', async () => {
    state.placeLookup = { data: null, error: null };
    const res = await POST_LIST(
      postReq({ google_place_id: 'unknown' }),
      tripCtx,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('place_not_cached');
  });

  it('AC6: duplicate (trip,place,category) → 409 bookmark_exists', async () => {
    state.bookmarkInsert = {
      data: null,
      error: { code: '23505', message: 'duplicate' },
    };
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      tripCtx,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bookmark_exists');
  });

  it('AC7: notes >500 chars → 400 validation_error', async () => {
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid', notes: 'a'.repeat(501) }),
      tripCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation_error');
  });

  it('AC8: rate limit — 11th request in 60s → 429', async () => {
    // Successful first 10
    for (let i = 0; i < 10; i++) {
      const r = await POST_LIST(
        postReq({ google_place_id: 'gpid' }),
        tripCtx,
      );
      expect(r.status).toBe(201);
    }
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      tripCtx,
    );
    expect(res.status).toBe(429);
  });

  it('AC9: writes bookmark_created audit entry', async () => {
    await POST_LIST(postReq({ google_place_id: 'gpid' }), tripCtx);
    const audit = auditCalls.find((a) => a.action === 'bookmark_created');
    expect(audit).toBeDefined();
    expect(audit?.entity).toBe('bookmarks');
    expect(audit?.tripId).toBe(FIXED_TRIP_ID);
    const meta = audit?.metadata as Record<string, unknown>;
    expect(meta.place_id).toBe(FIXED_PLACE_ROW_ID);
  });

  it('rejects invalid JSON body with 400', async () => {
    const req = new NextRequest(
      `http://localhost/api/trips/${FIXED_TRIP_ID}/bookmarks`,
      {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      },
    );
    const res = await POST_LIST(req, tripCtx);
    expect(res.status).toBe(400);
  });

  it('rejects malformed tripId in URL with 404', async () => {
    const res = await POST_LIST(
      postReq({ google_place_id: 'gpid' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET (list)
// ---------------------------------------------------------------------------

describe('GET /api/trips/[tripId]/bookmarks', () => {
  it('AC10: editor returns rows', async () => {
    state.list = {
      data: [defaultInsertedBookmark()],
      count: 1,
      error: null,
      selectCalls: 0,
    };
    const res = await GET_LIST(getReq(), tripCtx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookmarks: unknown[]; total: number };
    expect(body.total).toBe(1);
    expect(body.bookmarks).toHaveLength(1);
  });

  it('AC10b: viewer ok (read-only)', async () => {
    accessRole = 'viewer';
    const res = await GET_LIST(getReq(), tripCtx);
    expect(res.status).toBe(200);
  });

  it('AC10c: non-member (forbidden) → 403', async () => {
    accessRole = 'forbidden-other';
    const res = await GET_LIST(getReq(), tripCtx);
    expect(res.status).toBe(403);
  });

  it('AC10d: not_found reason → 404', async () => {
    accessRole = 'none';
    const res = await GET_LIST(getReq(), tripCtx);
    expect(res.status).toBe(404);
  });

  it('AC11: pagination page/limit are echoed', async () => {
    const res = await GET_LIST(getReq('?page=2&limit=10'), tripCtx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; limit: number };
    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);
  });

  it('AC11b: category filter accepted', async () => {
    const res = await GET_LIST(getReq('?category=museum'), tripCtx);
    expect(res.status).toBe(200);
  });

  it('AC11c: invalid category rejected with 400', async () => {
    const res = await GET_LIST(getReq('?category=cafe'), tripCtx);
    expect(res.status).toBe(400);
  });

  it('AC11d: limit > 200 rejected with 400', async () => {
    const res = await GET_LIST(getReq('?limit=999'), tripCtx);
    expect(res.status).toBe(400);
  });

  it('AC12: single SELECT used for list (foreign-table join, no per-row queries)', async () => {
    state.list = {
      data: [
        defaultInsertedBookmark(),
        { ...defaultInsertedBookmark(), id: '00000000-0000-4000-8000-000000000402' },
        { ...defaultInsertedBookmark(), id: '00000000-0000-4000-8000-000000000403' },
      ],
      count: 3,
      error: null,
      selectCalls: 0,
    };
    const res = await GET_LIST(getReq(), tripCtx);
    expect(res.status).toBe(200);
    // Exactly one .from('bookmarks') and one root .select() — no N+1.
    expect(state.listFromCalls).toBe(1);
    expect(state.list.selectCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

describe('PATCH /api/trips/[tripId]/bookmarks/[id]', () => {
  it('AC13: cross-trip request — bookmark belongs to other trip → 404', async () => {
    state.bookmarkExisting = {
      data: { id: FIXED_BOOKMARK_ID, trip_id: OTHER_TRIP_ID },
      error: null,
    };
    const res = await PATCH(patchReq({ category: 'sight' }), bookmarkCtx);
    expect(res.status).toBe(404);
  });

  it('AC14: editor PATCH succeeds', async () => {
    const res = await PATCH(patchReq({ category: 'sight' }), bookmarkCtx);
    expect(res.status).toBe(200);
    expect(state.capturedUpdates).toHaveLength(1);
    expect(state.capturedUpdates[0].category).toBe('sight');
  });

  it('AC14b: viewer PATCH → 403', async () => {
    accessRole = 'viewer';
    const res = await PATCH(patchReq({ category: 'sight' }), bookmarkCtx);
    expect(res.status).toBe(403);
  });

  it('AC15: PATCH category collision → 409 bookmark_exists', async () => {
    state.bookmarkUpdate = {
      data: null,
      error: { code: '23505', message: 'duplicate' },
    };
    const res = await PATCH(patchReq({ category: 'museum' }), bookmarkCtx);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bookmark_exists');
  });

  it('AC16a: writes bookmark_updated audit', async () => {
    await PATCH(patchReq({ notes: 'updated' }), bookmarkCtx);
    const audit = auditCalls.find((a) => a.action === 'bookmark_updated');
    expect(audit).toBeDefined();
    const meta = audit?.metadata as Record<string, unknown>;
    expect(meta.fields).toEqual(['notes']);
  });

  it('rejects empty PATCH body (no fields) with 400', async () => {
    const res = await PATCH(patchReq({}), bookmarkCtx);
    expect(res.status).toBe(400);
  });

  it('PATCH 401 when anon', async () => {
    state.auth = { user: null };
    const res = await PATCH(patchReq({ notes: 'x' }), bookmarkCtx);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/trips/[tripId]/bookmarks/[id]', () => {
  it('AC13: cross-trip delete — other trip → 404', async () => {
    state.bookmarkExisting = {
      data: { id: FIXED_BOOKMARK_ID, trip_id: OTHER_TRIP_ID },
      error: null,
    };
    const res = await DELETE(deleteReq(), bookmarkCtx);
    expect(res.status).toBe(404);
  });

  it('AC14: editor DELETE succeeds (204)', async () => {
    const res = await DELETE(deleteReq(), bookmarkCtx);
    expect(res.status).toBe(204);
    expect(state.capturedDeletes).toHaveLength(1);
    expect(state.capturedDeletes[0]).toEqual({
      id: FIXED_BOOKMARK_ID,
      tripId: FIXED_TRIP_ID,
    });
  });

  it('AC14b: viewer DELETE → 403', async () => {
    accessRole = 'viewer';
    const res = await DELETE(deleteReq(), bookmarkCtx);
    expect(res.status).toBe(403);
  });

  it('AC16b: writes bookmark_deleted audit', async () => {
    await DELETE(deleteReq(), bookmarkCtx);
    const audit = auditCalls.find((a) => a.action === 'bookmark_deleted');
    expect(audit).toBeDefined();
    expect(audit?.entityId).toBe(FIXED_BOOKMARK_ID);
    expect(audit?.tripId).toBe(FIXED_TRIP_ID);
  });

  it('DELETE 401 when anon', async () => {
    state.auth = { user: null };
    const res = await DELETE(deleteReq(), bookmarkCtx);
    expect(res.status).toBe(401);
  });

  it('DELETE on non-existent bookmark → 404', async () => {
    state.bookmarkExisting = { data: null, error: null };
    const res = await DELETE(deleteReq(), bookmarkCtx);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/trips — verify role field is exposed via foreign-table join shape
// ---------------------------------------------------------------------------

describe('GET /api/trips — TripPicker role filter', () => {
  // We re-mock supabase locally for this group via vi.doMock-equivalent: we
  // import a fresh module instance backed by a separate fake, by toggling
  // state. The trips route uses `.from('trips').select(... trip_members!inner(role)).eq(...).order(...).range(...)`
  // and reads the trip_members join.

  it('returns each trip with role (single object join shape)', async () => {
    // Hijack the existing global mock by stashing the fake row in `state.list`
    // and adding a new `from('trips')` branch via re-mock.
    vi.resetModules();

    vi.doMock('@/lib/supabase/server', () => ({
      createSupabaseServerClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }) },
        from: (_table: string) => {
          const chain: Record<string, unknown> = {};
          chain.select = () => chain;
          chain.eq = () => chain;
          chain.order = () => chain;
          chain.range = async () => ({
            data: [
              {
                id: FIXED_TRIP_ID,
                owner_id: FIXED_USER_ID,
                name: 'Trip A',
                start_date: '2026-05-01',
                end_date: '2026-05-03',
                destination: null,
                base_currency: 'EUR',
                total_budget: null,
                created_at: '2026-04-26T00:00:00Z',
                updated_at: '2026-04-26T00:00:00Z',
                trip_members: { role: 'editor' },
              },
            ],
            error: null,
            count: 1,
          });
          return chain;
        },
      }),
    }));
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ getAll: () => [], set: () => undefined }),
    }));
    vi.doMock('@/lib/audit', () => ({
      logAudit: async () => undefined,
    }));

    const tripsRoute = await import('@/app/api/trips/route');
    const req = new NextRequest('http://localhost/api/trips', { method: 'GET' });
    const res = await tripsRoute.GET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ id: string; role: string; name: string }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].role).toBe('editor');
    expect('trip_members' in body.items[0]).toBe(false);
  });

  it('returns role from array shape (Supabase variant)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase/server', () => ({
      createSupabaseServerClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }) },
        from: (_table: string) => {
          const chain: Record<string, unknown> = {};
          chain.select = () => chain;
          chain.eq = () => chain;
          chain.order = () => chain;
          chain.range = async () => ({
            data: [
              {
                id: FIXED_TRIP_ID,
                owner_id: FIXED_USER_ID,
                name: 'Trip B',
                start_date: '2026-05-01',
                end_date: '2026-05-03',
                destination: null,
                base_currency: 'EUR',
                total_budget: null,
                created_at: '2026-04-26T00:00:00Z',
                updated_at: '2026-04-26T00:00:00Z',
                trip_members: [{ role: 'viewer' }],
              },
            ],
            error: null,
            count: 1,
          });
          return chain;
        },
      }),
    }));
    vi.doMock('next/headers', () => ({
      cookies: async () => ({ getAll: () => [], set: () => undefined }),
    }));
    vi.doMock('@/lib/audit', () => ({
      logAudit: async () => undefined,
    }));

    const tripsRoute = await import('@/app/api/trips/route');
    const req = new NextRequest('http://localhost/api/trips', { method: 'GET' });
    const res = await tripsRoute.GET(req);
    const body = (await res.json()) as {
      items: Array<{ role: string }>;
    };
    expect(body.items[0].role).toBe('viewer');
  });
});
