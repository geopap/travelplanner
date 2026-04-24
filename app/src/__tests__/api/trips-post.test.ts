import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { FIXED_USER_ID, makeTripInput } from '../factories';

// ---- Mocks ----
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock('@/lib/audit', () => ({
  logAudit: async (p: Record<string, unknown>) => {
    auditCalls.push(p);
  },
}));

// Per-test controllable state.
interface FakeDbState {
  insertedTrip?: Record<string, unknown>;
  insertedDayRows?: Array<Record<string, unknown>>;
  daysError?: unknown;
  deletedTripId?: string;
}
const db: FakeDbState = {};

function makeChain(table: string) {
  // Chainable no-op that terminates in the shapes the route expects.
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.insert = (rows: unknown) => {
    if (table === 'trips') {
      db.insertedTrip = {
        id: '00000000-0000-4000-8000-0000000000aa',
        ...(rows as Record<string, unknown>),
      };
      return {
        select: () => ({
          single: async () => ({ data: db.insertedTrip, error: null }),
        }),
      };
    }
    if (table === 'trip_days') {
      db.insertedDayRows = rows as Array<Record<string, unknown>>;
      if (db.daysError) {
        return {
          select: async () => ({ data: null, error: db.daysError }),
        };
      }
      const out = db.insertedDayRows.map((r, i) => ({
        id: `00000000-0000-4000-8000-0000000000${(100 + i).toString(16).padStart(2, '0')}`,
        ...r,
      }));
      return {
        select: async () => ({ data: out, error: null }),
      };
    }
    return chain;
  };
  chain.delete = () => ({
    eq: (_col: string, id: string) => {
      db.deletedTripId = id;
      return Promise.resolve({ error: null });
    },
  });
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.range = async () => ({ data: [], error: null, count: 0 });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: FIXED_USER_ID } } }),
    },
    from: (table: string) => makeChain(table),
  }),
}));

// ---- Import AFTER mocks ----
import { POST, GET } from '@/app/api/trips/route';

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/trips', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  auditCalls.length = 0;
  db.insertedTrip = undefined;
  db.insertedDayRows = undefined;
  db.daysError = undefined;
  db.deletedTripId = undefined;
});

describe('POST /api/trips — day seeding', () => {
  it('seeds end_date - start_date + 1 days (inclusive)', async () => {
    // 2026-05-01 .. 2026-05-03 = 3 days
    const res = await POST(postReq(makeTripInput()));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { trip: unknown; days: Array<{ date: string; day_number: number }> };
    expect(json.days.length).toBe(3);
    expect(json.days[0].day_number).toBe(1);
    expect(json.days[0].date).toBe('2026-05-01');
    expect(json.days[2].date).toBe('2026-05-03');
  });

  it('seeds single day for same start/end', async () => {
    const res = await POST(
      postReq(makeTripInput({ start_date: '2026-05-05', end_date: '2026-05-05' })),
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { days: unknown[] };
    expect(json.days.length).toBe(1);
  });

  it('rejects trip exceeding 365 days at the schema layer', async () => {
    const res = await POST(
      postReq(makeTripInput({ start_date: '2026-01-01', end_date: '2027-01-03' })),
    );
    expect(res.status).toBe(400);
  });

  it('writes an audit log entry with day_count metadata', async () => {
    await POST(postReq(makeTripInput()));
    const trip = auditCalls.find((a) => a.action === 'create' && a.entity === 'trips');
    expect(trip).toBeDefined();
    expect((trip?.metadata as Record<string, unknown>).day_count).toBe(3);
  });

  it('rolls back trip if day seeding fails', async () => {
    db.daysError = new Error('days insert failed');
    const res = await POST(postReq(makeTripInput()));
    expect(res.status).toBe(500);
    expect(db.deletedTripId).toBe('00000000-0000-4000-8000-0000000000aa');
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/trips', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/trips pagination', () => {
  it('accepts page and limit query params', async () => {
    const req = new NextRequest('http://localhost/api/trips?page=2&limit=5', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { page: number; limit: number; items: unknown[] };
    expect(json.page).toBe(2);
    expect(json.limit).toBe(5);
  });

  it('rejects limit > 100', async () => {
    const req = new NextRequest('http://localhost/api/trips?limit=500', { method: 'GET' });
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});
