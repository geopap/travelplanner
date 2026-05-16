/**
 * B-031 — DayBookmarksSection: pure-logic tests.
 *
 * Mirrors the day-map-section pattern: vitest runs in `node` env (no jsdom by
 * default), and Link/Next-router imports would crash a component-level render.
 * This suite locks down the four contracts the component depends on:
 *   - storageKey() — localStorage namespacing format
 *   - fallbackName() — display fallback when bookmark.place is null
 *   - hrefFor() — click-through URL shape (or null when not clickable)
 *   - hideWhenEmpty — section is hidden when bookmarks.length === 0
 *
 * If any of these change in the component, fix this file too — the test IS
 * the contract.
 */
import { describe, expect, it } from 'vitest';

// Mirror of the private helper in DayBookmarksSection.tsx.
function storageKey(tripId: string, dayId: string): string {
  return `tp.b031.dayBookmarks.${tripId}.${dayId}`;
}

interface RowLike {
  notes: string | null;
  place: { google_place_id: string; name: string } | null;
}

function fallbackName(row: { notes: string | null }): string {
  const seg = row.notes?.split(' — ')[0]?.trim();
  return seg && seg.length > 0 ? seg : 'Untitled place';
}

function hrefFor(row: RowLike, tripId: string): string | null {
  if (!row.place) return null;
  return `/places/${encodeURIComponent(row.place.google_place_id)}?trip=${encodeURIComponent(tripId)}`;
}

function shouldHide(rows: RowLike[]): boolean {
  return rows.length === 0;
}

describe('DayBookmarksSection storageKey (B-031)', () => {
  it('formats tp.b031.dayBookmarks.<tripId>.<dayId>', () => {
    expect(storageKey('trip-1', 'day-1')).toBe(
      'tp.b031.dayBookmarks.trip-1.day-1',
    );
  });

  it('produces distinct keys per (tripId, dayId)', () => {
    expect(storageKey('t', 'd1')).not.toBe(storageKey('t', 'd2'));
    expect(storageKey('t1', 'd')).not.toBe(storageKey('t2', 'd'));
  });

  it('does not collide with the B-015 day-map key', () => {
    // The map uses `tp.b015.dayMap.*` — they must remain distinct.
    expect(storageKey('t', 'd').startsWith('tp.b015.')).toBe(false);
  });
});

describe('DayBookmarksSection fallbackName (B-031)', () => {
  it('returns "Untitled place" when notes is null', () => {
    expect(fallbackName({ notes: null })).toBe('Untitled place');
  });

  it('returns "Untitled place" when notes is empty', () => {
    expect(fallbackName({ notes: '' })).toBe('Untitled place');
  });

  it('returns the leading " — " segment when present', () => {
    expect(fallbackName({ notes: 'Senso-ji Temple — Tokyo, Japan' })).toBe(
      'Senso-ji Temple',
    );
  });

  it('returns the whole string when no " — " separator', () => {
    expect(fallbackName({ notes: 'Just a name' })).toBe('Just a name');
  });

  it('trims whitespace from the segment', () => {
    expect(fallbackName({ notes: '   Padded  ' })).toBe('Padded');
  });
});

describe('DayBookmarksSection hrefFor (B-031)', () => {
  const tripId = '00000000-0000-4000-8000-000000000010';

  it('builds /places/<google_place_id>?trip=<tripId> when place is present', () => {
    const href = hrefFor(
      {
        notes: null,
        place: { google_place_id: 'ChIJ_xyz', name: 'X' },
      },
      tripId,
    );
    expect(href).toBe(`/places/ChIJ_xyz?trip=${tripId}`);
  });

  it('returns null when place is null (muted, non-clickable variant)', () => {
    expect(hrefFor({ notes: 'Mystery', place: null }, tripId)).toBeNull();
  });

  it('URL-encodes google_place_id and tripId', () => {
    const href = hrefFor(
      {
        notes: null,
        place: { google_place_id: 'a/b c', name: 'X' },
      },
      'trip with spaces',
    );
    expect(href).toBe(`/places/a%2Fb%20c?trip=trip%20with%20spaces`);
  });
});

describe('DayBookmarksSection shouldHide (B-031 AC 1 + 8)', () => {
  it('hides when no paired bookmarks', () => {
    expect(shouldHide([])).toBe(true);
  });

  it('renders when ≥ 1 paired bookmark', () => {
    expect(
      shouldHide([
        { notes: null, place: { google_place_id: 'g', name: 'n' } },
      ]),
    ).toBe(false);
  });
});
