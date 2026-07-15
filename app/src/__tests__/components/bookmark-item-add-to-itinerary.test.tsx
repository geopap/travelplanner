/**
 * @vitest-environment jsdom
 *
 * B-033 — BookmarkItem "Add to itinerary" button visibility.
 *   - Viewers never see the button.
 *   - Editors/owners see it only when an `onAddToItinerary` handler is
 *     provided AND the bookmark has a non-null `place_id`.
 *   - Clicking the button invokes the handler with the bookmark.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Bookmark } from '@/lib/types/domain';
import { BookmarkItem } from '@/components/bookmarks/BookmarkItem';

afterEach(() => cleanup());

const PLACE_ID = '22222222-2222-4333-8444-666666666666';

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-1',
    trip_id: '11111111-2222-4333-8444-555555555555',
    place_id: PLACE_ID,
    category: 'restaurant',
    notes: null,
    added_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    place: {
      name: 'Sushi Saito',
      formatted_address: '1 Chome Akasaka',
      category: 'restaurant',
      lat: 35.67,
      lng: 139.73,
    },
    ...overrides,
  };
}

describe('BookmarkItem — Add to itinerary affordance', () => {
  it('viewer never sees the Add to itinerary button', () => {
    render(
      <BookmarkItem
        bookmark={makeBookmark()}
        role="viewer"
        onEdit={() => undefined}
        onDelete={() => undefined}
        onAddToItinerary={() => undefined}
      />,
    );
    expect(screen.queryByTestId('bookmark-add-to-itinerary')).toBeNull();
  });

  it('editor sees the button when handler is provided and place_id is set', () => {
    render(
      <BookmarkItem
        bookmark={makeBookmark()}
        role="editor"
        onEdit={() => undefined}
        onDelete={() => undefined}
        onAddToItinerary={() => undefined}
      />,
    );
    expect(screen.getByTestId('bookmark-add-to-itinerary')).toBeTruthy();
  });

  it('owner sees the button when handler is provided and place_id is set', () => {
    render(
      <BookmarkItem
        bookmark={makeBookmark()}
        role="owner"
        onEdit={() => undefined}
        onDelete={() => undefined}
        onAddToItinerary={() => undefined}
      />,
    );
    expect(screen.getByTestId('bookmark-add-to-itinerary')).toBeTruthy();
  });

  it('hidden when no handler supplied (parent opted-out)', () => {
    render(
      <BookmarkItem
        bookmark={makeBookmark()}
        role="editor"
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(screen.queryByTestId('bookmark-add-to-itinerary')).toBeNull();
  });

  it('hidden when bookmark has null place_id (cannot resolve title)', () => {
    render(
      <BookmarkItem
        bookmark={makeBookmark({ place_id: null, place: undefined })}
        role="editor"
        onEdit={() => undefined}
        onDelete={() => undefined}
        onAddToItinerary={() => undefined}
      />,
    );
    expect(screen.queryByTestId('bookmark-add-to-itinerary')).toBeNull();
  });

  it('invokes onAddToItinerary with the bookmark when clicked', () => {
    const handler = vi.fn();
    const bm = makeBookmark();
    render(
      <BookmarkItem
        bookmark={bm}
        role="editor"
        onEdit={() => undefined}
        onDelete={() => undefined}
        onAddToItinerary={handler}
      />,
    );
    fireEvent.click(screen.getByTestId('bookmark-add-to-itinerary'));
    expect(handler).toHaveBeenCalledWith(bm);
  });
});
