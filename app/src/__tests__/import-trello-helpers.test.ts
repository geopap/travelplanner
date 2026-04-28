/**
 * Unit tests for pure helpers in app/scripts/import-trello.ts (B-016).
 *
 * Scope: deterministic, no Supabase. Covers label routing, transport-mode
 * inference, hotel pairing, anon-key JWT guard, CLI parsing, and Trello
 * dated-list parsing. End-to-end --dry-run + DB import are deferred to UAT
 * (no test-DB infra in CI).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseArgs,
  looksLikeAnonKey,
  parseDatedList,
  classify,
  inferTransportMode,
  hotelKind,
  pairHotels,
  type Summary,
} from '../../scripts/import-trello';

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------

interface TrelloLabelLite {
  id: string;
  name: string;
}

interface TrelloCardLite {
  id: string;
  name: string;
  desc: string | null;
  idList: string;
  labels: TrelloLabelLite[];
  closed: boolean;
}

function makeCard(partial: Partial<TrelloCardLite> & { id: string; name: string }): TrelloCardLite {
  return {
    desc: null,
    idList: 'list-1',
    labels: [],
    closed: false,
    ...partial,
  };
}

function makeSummary(): Summary {
  return {
    trips: 0,
    days: 0,
    items: 0,
    transportation: 0,
    accommodations: 0,
    bookmarks: 0,
    skipped: 0,
    errors: 0,
    unpairedHotels: [],
    unlabeledCardIds: [],
  };
}

// Minimal JWT builder — `{header}.{payload}.{sig}` with base64url payload.
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) =>
    Buffer.from(s, 'utf8')
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.signature-stub`;
}

// ---------------------------------------------------------------------------
// 1. CLI arg parsing.
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('--user-email value form', () => {
    expect(parseArgs(['--user-email', 'me@example.com'])).toEqual({
      userEmail: 'me@example.com',
      dryRun: false,
    });
  });

  it('--user-email=value form', () => {
    expect(parseArgs(['--user-email=me@example.com'])).toEqual({
      userEmail: 'me@example.com',
      dryRun: false,
    });
  });

  it('--dry-run flag toggles', () => {
    expect(parseArgs(['--user-email', 'a@b.co', '--dry-run'])).toEqual({
      userEmail: 'a@b.co',
      dryRun: true,
    });
  });

  it('throws when --user-email missing', () => {
    expect(() => parseArgs([])).toThrow(/--user-email/);
  });

  it('throws when --user-email has no value', () => {
    expect(() => parseArgs(['--user-email'])).toThrow(/--user-email/);
  });
});

// ---------------------------------------------------------------------------
// 2. Anon-key JWT guard.
// ---------------------------------------------------------------------------

describe('looksLikeAnonKey', () => {
  it('returns true for role:anon JWT', () => {
    expect(looksLikeAnonKey(makeJwt({ role: 'anon', iss: 'supabase' }))).toBe(true);
  });

  it('returns false for role:service_role JWT', () => {
    expect(looksLikeAnonKey(makeJwt({ role: 'service_role', iss: 'supabase' }))).toBe(false);
  });

  it('returns false for non-JWT string', () => {
    expect(looksLikeAnonKey('not-a-jwt')).toBe(false);
  });

  it('returns false for malformed JWT (wrong segment count)', () => {
    expect(looksLikeAnonKey('a.b')).toBe(false);
  });

  it('returns false for JWT with non-JSON payload', () => {
    expect(looksLikeAnonKey('aaa.bbb.ccc')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Trello dated-list parsing.
// ---------------------------------------------------------------------------

describe('parseDatedList', () => {
  it('parses DD.MM.YYYY inside trip range', () => {
    expect(parseDatedList('13.11.2026')).toBe('2026-11-13');
    expect(parseDatedList('08.12.2026')).toBe('2026-12-08');
  });

  it('returns null for non-dated lists (e.g. "To Plan")', () => {
    expect(parseDatedList('To Plan')).toBeNull();
    expect(parseDatedList('Inbox')).toBeNull();
  });

  it('returns null for dates outside the trip range', () => {
    expect(parseDatedList('12.11.2026')).toBeNull(); // before start
    expect(parseDatedList('09.12.2026')).toBeNull(); // after end
    expect(parseDatedList('15.06.2024')).toBeNull(); // archive year
  });

  it('trims whitespace', () => {
    expect(parseDatedList('  20.11.2026  ')).toBe('2026-11-20');
  });
});

describe('Trello export structural parse — identifies dated lists only', () => {
  it('counts dated lists inside trip range across a mixed export', () => {
    const lists = [
      { id: 'L1', name: '13.11.2026', closed: false },
      { id: 'L2', name: '14.11.2026', closed: false },
      { id: 'L3', name: 'To Plan', closed: false },
      { id: 'L4', name: '08.12.2026', closed: false },
      { id: 'L5', name: '09.12.2026', closed: false }, // out of range
      { id: 'L6', name: '15.06.2024', closed: false }, // archive
      { id: 'L7', name: 'Inbox', closed: true },
    ];
    const dated = lists
      .filter((l) => !l.closed)
      .map((l) => parseDatedList(l.name))
      .filter((iso): iso is string => iso !== null);
    expect(dated).toEqual(['2026-11-13', '2026-11-14', '2026-12-08']);
  });
});

// ---------------------------------------------------------------------------
// 4. Label routing.
// ---------------------------------------------------------------------------

describe('classify', () => {
  it('Transportation label → transportation', () => {
    expect(classify(makeCard({ id: 'c1', name: 'x', labels: [{ id: 'l', name: 'Transportation' }] })))
      .toBe('transportation');
  });

  it('Hotels label → hotels', () => {
    expect(classify(makeCard({ id: 'c1', name: 'x', labels: [{ id: 'l', name: 'Hotels' }] })))
      .toBe('hotels');
  });

  it('Restaurants/Museums/Attractions/Shopping route correctly', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Restaurants' }] }))).toBe('restaurants');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Museums' }] }))).toBe('museums');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Attractions' }] }))).toBe('attractions');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Shopping' }] }))).toBe('shopping');
  });

  it('matches case-insensitively', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'TRANSPORTATION' }] }))).toBe('transportation');
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'restaurants' }] }))).toBe('restaurants');
  });

  it('no labels → unlabeled (note)', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [] }))).toBe('unlabeled');
  });

  it('unknown label → unlabeled', () => {
    expect(classify(makeCard({ id: 'c', name: 'x', labels: [{ id: 'l', name: 'Random' }] }))).toBe('unlabeled');
  });
});

// ---------------------------------------------------------------------------
// 5. Transport mode inference.
// ---------------------------------------------------------------------------

describe('inferTransportMode', () => {
  it.each([
    ['Flight to Tokyo', 'flight'],
    ['Shinkansen Train', 'train'],
    ['Bus to Kyoto', 'bus'],
    ['Car rental', 'car'],
    ['Ferry to Miyajima', 'ferry'],
    ['Walking tour', 'other'],
    ['Random unrecognized', 'other'],
  ] as const)('"%s" → %s', (name, expected) => {
    expect(inferTransportMode(name)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 6. Hotel pairing algorithm.
// ---------------------------------------------------------------------------

describe('hotelKind', () => {
  it('parses "Checkin - Hotel X"', () => {
    expect(hotelKind('Checkin - Hotel Tokyo')).toEqual({ kind: 'checkin', canonical: 'Hotel Tokyo' });
  });
  it('parses "Checkout - Hotel X"', () => {
    expect(hotelKind('Checkout - Hotel Tokyo')).toEqual({ kind: 'checkout', canonical: 'Hotel Tokyo' });
  });
  it('treats unknown prefix as unknown', () => {
    expect(hotelKind('Random Hotel').kind).toBe('unknown');
  });
});

describe('pairHotels', () => {
  // Silence logWarn/logError stderr noise during these tests.
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('pairs simple 1 checkin + 1 checkout for same hotel', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [
        { card: makeCard({ id: 'a', name: 'Checkin - Park Hotel' }), date: '2026-11-13' },
        { card: makeCard({ id: 'b', name: 'Checkout - Park Hotel' }), date: '2026-11-15' },
      ],
      summary,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      canonical: 'Park Hotel',
      checkInDate: '2026-11-13',
      checkOutDate: '2026-11-15',
      sourceCardId: 'a',
    });
    expect(summary.errors).toBe(0);
    expect(summary.unpairedHotels).toEqual([]);
  });

  it('unpaired Checkin → defaults to +1 day, records unpairedHotels and warns', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [{ card: makeCard({ id: 'a', name: 'Checkin - Solo Hotel' }), date: '2026-11-20' }],
      summary,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      canonical: 'Solo Hotel',
      checkInDate: '2026-11-20',
      checkOutDate: '2026-11-21',
    });
    expect(summary.unpairedHotels).toContain('checkin:Solo Hotel');
    expect(summary.errors).toBe(0); // unpaired-checkin is a warning, not an error
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('unpaired Checkout → skipped, records unpairedHotels, increments errors', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [{ card: makeCard({ id: 'a', name: 'Checkout - Ghost Hotel' }), date: '2026-11-22' }],
      summary,
    );
    expect(pairs).toHaveLength(0);
    expect(summary.unpairedHotels).toContain('checkout:Ghost Hotel');
    expect(summary.errors).toBe(1);
  });

  it('duplicate names across cards pair chronologically', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [
        { card: makeCard({ id: 'ci-a', name: 'Checkin - Repeat Hotel' }), date: '2026-11-13' },
        { card: makeCard({ id: 'co-a', name: 'Checkout - Repeat Hotel' }), date: '2026-11-15' },
        { card: makeCard({ id: 'ci-b', name: 'Checkin - Repeat Hotel' }), date: '2026-11-25' },
        { card: makeCard({ id: 'co-b', name: 'Checkout - Repeat Hotel' }), date: '2026-11-28' },
      ],
      summary,
    );
    expect(pairs).toHaveLength(2);
    // Pairs should be in chronological order by check-in.
    const sorted = [...pairs].sort((a, b) => a.checkInDate.localeCompare(b.checkInDate));
    expect(sorted[0]).toMatchObject({ checkInDate: '2026-11-13', checkOutDate: '2026-11-15', sourceCardId: 'ci-a' });
    expect(sorted[1]).toMatchObject({ checkInDate: '2026-11-25', checkOutDate: '2026-11-28', sourceCardId: 'ci-b' });
    expect(summary.errors).toBe(0);
  });

  it('mixed-date input is sorted before pairing (earliest checkout >= checkin)', () => {
    const summary = makeSummary();
    // Provide entries in scrambled order; expected pairing should still match earliest valid checkout.
    const pairs = pairHotels(
      [
        { card: makeCard({ id: 'co-late', name: 'Checkout - Mix Hotel' }), date: '2026-11-28' },
        { card: makeCard({ id: 'ci-early', name: 'Checkin - Mix Hotel' }), date: '2026-11-13' },
        { card: makeCard({ id: 'ci-late', name: 'Checkin - Mix Hotel' }), date: '2026-11-25' },
        { card: makeCard({ id: 'co-early', name: 'Checkout - Mix Hotel' }), date: '2026-11-15' },
      ],
      summary,
    );
    expect(pairs).toHaveLength(2);
    const byCheckin = [...pairs].sort((a, b) => a.checkInDate.localeCompare(b.checkInDate));
    expect(byCheckin[0]).toMatchObject({ checkInDate: '2026-11-13', checkOutDate: '2026-11-15' });
    expect(byCheckin[1]).toMatchObject({ checkInDate: '2026-11-25', checkOutDate: '2026-11-28' });
  });

  it('hotel card without checkin/checkout prefix → skipped + summary.skipped++', () => {
    const summary = makeSummary();
    const pairs = pairHotels(
      [{ card: makeCard({ id: 'a', name: 'Random Hotel Note' }), date: '2026-11-20' }],
      summary,
    );
    expect(pairs).toHaveLength(0);
    expect(summary.skipped).toBe(1);
  });
});
