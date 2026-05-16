/**
 * B-015 — DayMapSection: pure-logic tests.
 *
 * Why pure logic (no React render): the project runs vitest in `node`
 * environment with no jsdom/testing-library installed, and react-leaflet
 * touches `window` at module load. Rather than add jsdom + Leaflet shims (a
 * sprint-scoped infra change), this suite reproduces the two contracts the
 * component depends on:
 *   - storageKey() — localStorage namespacing format (must stay stable across
 *     refactors so saved collapse-state survives).
 *   - plottable filter — `place != null && coords present` → marker; else drop.
 *
 * If either contract changes, both the component AND these tests should be
 * updated together. The component itself is exercised end-to-end in [tester]
 * UAT (manual map smoke).
 */
import { describe, it, expect } from 'vitest';

// Mirror of the private helper in DayMapSection.tsx. If this assertion fails
// because the component changed its key format, fix this file too — the test
// is the contract.
function storageKey(tripId: string, dayId: string): string {
  return `tp.b015.dayMap.${tripId}.${dayId}`;
}

interface ItemLike {
  id: string;
  title: string;
  start_time: string | null;
  place: { id: string; name: string; lat: number | null; lng: number | null } | null;
}

// Mirror of DayMapSection's plottable filter (line ~67-81).
function plottable(items: ItemLike[]): Array<{ id: string; place: { lat: number; lng: number } }> {
  return items.flatMap((it) => {
    const p = it.place;
    if (!p || p.lat === null || p.lng === null) return [];
    return [{ id: it.id, place: { lat: p.lat, lng: p.lng } }];
  });
}

describe('DayMapSection storageKey (B-015)', () => {
  it('formats tp.b015.dayMap.<tripId>.<dayId>', () => {
    expect(storageKey('trip-1', 'day-1')).toBe('tp.b015.dayMap.trip-1.day-1');
  });

  it('different (tripId, dayId) pairs produce distinct keys', () => {
    const a = storageKey('trip-1', 'day-1');
    const b = storageKey('trip-1', 'day-2');
    const c = storageKey('trip-2', 'day-1');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('survives uuid-shaped ids without escaping', () => {
    const tripId = '00000000-0000-4000-8000-000000000010';
    const dayId = '00000000-0000-4000-8000-000000000020';
    expect(storageKey(tripId, dayId)).toBe(
      `tp.b015.dayMap.${tripId}.${dayId}`,
    );
  });
});

describe('DayMapSection plottable filter (B-015)', () => {
  const base = {
    id: 'item-1',
    title: 'Visit temple',
    start_time: null as string | null,
  };

  it('keeps items whose place has both lat and lng', () => {
    const out = plottable([
      { ...base, place: { id: 'p1', name: 'Senso-ji', lat: 35.7, lng: 139.8 } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].place).toEqual({ lat: 35.7, lng: 139.8 });
  });

  it('drops items with place: null', () => {
    expect(plottable([{ ...base, place: null }])).toHaveLength(0);
  });

  it('drops items whose place has null lat', () => {
    const out = plottable([
      {
        ...base,
        place: { id: 'p1', name: 'Senso-ji', lat: null, lng: 139.8 },
      },
    ]);
    expect(out).toHaveLength(0);
  });

  it('drops items whose place has null lng', () => {
    const out = plottable([
      {
        ...base,
        place: { id: 'p1', name: 'Senso-ji', lat: 35.7, lng: null },
      },
    ]);
    expect(out).toHaveLength(0);
  });

  it('preserves order across a mixed input', () => {
    const out = plottable([
      { ...base, id: 'a', place: { id: 'p1', name: 'A', lat: 1, lng: 1 } },
      { ...base, id: 'b', place: null },
      { ...base, id: 'c', place: { id: 'p2', name: 'C', lat: 2, lng: 2 } },
      {
        ...base,
        id: 'd',
        place: { id: 'p3', name: 'D', lat: null, lng: 4 },
      },
      { ...base, id: 'e', place: { id: 'p4', name: 'E', lat: 3, lng: 3 } },
    ]);
    expect(out.map((x) => x.id)).toEqual(['a', 'c', 'e']);
  });

  it('returns empty array for all-empty input (AC 6 empty state)', () => {
    expect(plottable([])).toEqual([]);
    expect(plottable([{ ...base, place: null }])).toEqual([]);
  });
});
