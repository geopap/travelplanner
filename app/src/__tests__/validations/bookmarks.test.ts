import { describe, it, expect } from 'vitest';
import {
  CreateBookmarkInput,
  UpdateBookmarkInput,
  ListBookmarksQuery,
  BookmarkRowSchema,
  mapBookmarkRow,
} from '@/lib/validations/bookmarks';

const VALID_PLACE_ID = 'ChIJ_test_google_place_id_123';

describe('CreateBookmarkInput', () => {
  it('accepts a minimal valid input (just google_place_id)', () => {
    const r = CreateBookmarkInput.safeParse({ google_place_id: VALID_PLACE_ID });
    expect(r.success).toBe(true);
  });

  it('accepts category override', () => {
    const r = CreateBookmarkInput.safeParse({
      google_place_id: VALID_PLACE_ID,
      category: 'museum',
    });
    expect(r.success).toBe(true);
  });

  it('accepts notes up to 500 chars', () => {
    const r = CreateBookmarkInput.safeParse({
      google_place_id: VALID_PLACE_ID,
      notes: 'a'.repeat(500),
    });
    expect(r.success).toBe(true);
  });

  it('rejects notes >500 chars', () => {
    const r = CreateBookmarkInput.safeParse({
      google_place_id: VALID_PLACE_ID,
      notes: 'a'.repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty google_place_id', () => {
    const r = CreateBookmarkInput.safeParse({ google_place_id: '' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid category', () => {
    const r = CreateBookmarkInput.safeParse({
      google_place_id: VALID_PLACE_ID,
      category: 'cafe', // not in narrowed bookmark set
    });
    expect(r.success).toBe(false);
  });

  it('rejects missing google_place_id', () => {
    const r = CreateBookmarkInput.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('UpdateBookmarkInput', () => {
  it('accepts category-only patch', () => {
    const r = UpdateBookmarkInput.safeParse({ category: 'sight' });
    expect(r.success).toBe(true);
  });

  it('accepts notes-only patch', () => {
    const r = UpdateBookmarkInput.safeParse({ notes: 'new note' });
    expect(r.success).toBe(true);
  });

  it('accepts notes=null (clear)', () => {
    const r = UpdateBookmarkInput.safeParse({ notes: null });
    expect(r.success).toBe(true);
  });

  it('rejects empty object (must provide at least one field)', () => {
    const r = UpdateBookmarkInput.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rejects notes >500 chars', () => {
    const r = UpdateBookmarkInput.safeParse({ notes: 'a'.repeat(501) });
    expect(r.success).toBe(false);
  });

  it('rejects invalid category in patch', () => {
    const r = UpdateBookmarkInput.safeParse({ category: 'hotel' });
    expect(r.success).toBe(false);
  });
});

describe('ListBookmarksQuery', () => {
  it('defaults page=1, limit=50 when omitted', () => {
    const r = ListBookmarksQuery.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
      expect(r.data.limit).toBe(50);
    }
  });

  it('coerces string numbers from query string', () => {
    const r = ListBookmarksQuery.safeParse({ page: '2', limit: '10' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.limit).toBe(10);
    }
  });

  it('rejects limit > 200', () => {
    const r = ListBookmarksQuery.safeParse({ limit: '201' });
    expect(r.success).toBe(false);
  });

  it('accepts category filter', () => {
    const r = ListBookmarksQuery.safeParse({ category: 'restaurant' });
    expect(r.success).toBe(true);
  });
});

describe('BookmarkRowSchema + mapBookmarkRow', () => {
  const baseRow = {
    id: '00000000-0000-4000-8000-000000000401',
    trip_id: '00000000-0000-4000-8000-000000000010',
    place_id: '00000000-0000-4000-8000-000000000402',
    category: 'restaurant' as const,
    notes: null,
    added_by: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-04-26T00:00:00Z',
    updated_at: '2026-04-26T00:00:00Z',
  };

  it('parses a row with no place', () => {
    const r = BookmarkRowSchema.safeParse(baseRow);
    expect(r.success).toBe(true);
  });

  it('parses with place as object', () => {
    const r = BookmarkRowSchema.safeParse({
      ...baseRow,
      place: {
        name: 'Cafe X',
        formatted_address: '1 Street',
        category: 'cafe',
        lat: 1.0,
        lng: 2.0,
      },
    });
    expect(r.success).toBe(true);
  });

  it('parses with place as single-element array (Supabase variant)', () => {
    const r = BookmarkRowSchema.safeParse({
      ...baseRow,
      place: [
        {
          name: 'Cafe X',
          formatted_address: null,
          category: 'cafe',
          lat: null,
          lng: null,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('mapBookmarkRow flattens single-element place array to object', () => {
    const out = mapBookmarkRow({
      ...baseRow,
      place: [
        {
          name: 'Cafe X',
          formatted_address: null,
          category: 'cafe',
          lat: null,
          lng: null,
        },
      ],
    });
    expect(out.place).toBeDefined();
    expect(out.place?.name).toBe('Cafe X');
  });

  it('mapBookmarkRow omits place when nullish', () => {
    const out = mapBookmarkRow(baseRow);
    expect('place' in out).toBe(false);
  });
});
