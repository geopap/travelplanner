/**
 * @vitest-environment jsdom
 *
 * B-028 — BookmarkList tabbed-categories unit tests.
 *
 * Covers tab counts, default active tab, URL sync (?cat=), arrow-key roving
 * tabindex, invalid ?cat= fallback, ARIA wiring, empty state, and mutation
 * tab-preservation. Leaflet/BookmarkItem internals are stubbed; we focus on
 * the tablist behaviour added in B-028.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { Bookmark, BookmarkCategory } from '@/lib/types/domain';

// --- next/navigation mock with mutable searchParams/router.replace -----
let urlParams = new URLSearchParams();
const replaceMock = vi.fn((url: string) => {
  const q = url.split('?')[1] ?? '';
  urlParams = new URLSearchParams(q);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => urlParams,
  usePathname: () => '/trips/trip-1/places',
}));

// --- useBookmarks: return state-driven list (mutation by test setBookmarks)
let currentBookmarks: Bookmark[] = [];
const refetchMock = vi.fn(async () => undefined);
vi.mock('@/lib/hooks/useBookmarks', () => ({
  useBookmarks: () => ({
    bookmarks: currentBookmarks,
    loading: false,
    error: null,
    refetch: refetchMock,
  }),
}));

// --- Stub child components that pull in extra deps ---------------------
vi.mock('@/components/bookmarks/BookmarkItem', () => ({
  BookmarkItem: ({ bookmark }: { bookmark: Bookmark }) => (
    <li data-testid={`bm-${bookmark.id}`}>{bookmark.place?.name ?? '(no name)'}</li>
  ),
}));
vi.mock('@/components/bookmarks/BookmarkForm', () => ({
  BookmarkForm: () => null,
}));
vi.mock('@/components/bookmarks/BookmarkDeleteDialog', () => ({
  BookmarkDeleteDialog: () => null,
}));

import { BookmarkList } from '@/components/bookmarks/BookmarkList';

// --- Fixtures ----------------------------------------------------------
function bm(id: string, category: BookmarkCategory, name: string): Bookmark {
  return {
    id,
    trip_id: 'trip-1',
    place_id: `place-${id}`,
    category,
    notes: null,
    added_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    place: {
      name,
      formatted_address: null,
      category: category === 'restaurant' ? 'restaurant' : 'sight',
      lat: null,
      lng: null,
    },
  };
}

const SAMPLE: Bookmark[] = [
  bm('r1', 'restaurant', 'Sushi Saito'),
  bm('r2', 'restaurant', 'Ramen Ichi'),
  bm('s1', 'sight', 'Tokyo Tower'),
  bm('m1', 'museum', 'Edo Museum'),
  bm('m2', 'museum', 'TeamLab'),
  bm('m3', 'museum', 'Mori Museum'),
];

function renderList(bookmarks: Bookmark[] = SAMPLE) {
  currentBookmarks = bookmarks;
  return render(
    <BookmarkList
      tripId="trip-1"
      role="editor"
      initialBookmarks={bookmarks}
      googlePlaceIdByPlaceId={{}}
    />,
  );
}

beforeEach(() => {
  urlParams = new URLSearchParams();
  replaceMock.mockClear();
  refetchMock.mockClear();
  currentBookmarks = [];
});

afterEach(() => {
  cleanup();
});

describe('BookmarkList tabs (B-028)', () => {
  it('renders tabs in GROUP_ORDER with correct counts', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    // GROUP_ORDER = restaurant, sight, museum, shopping, other
    expect(tabs).toHaveLength(5);
    expect(tabs[0].textContent).toMatch(/Restaurants\s*\(2\)/);
    expect(tabs[1].textContent).toMatch(/Sights\s*\(1\)/);
    expect(tabs[2].textContent).toMatch(/Museums\s*\(3\)/);
    expect(tabs[3].textContent).toMatch(/Shopping\s*\(0\)/);
    expect(tabs[4].textContent).toMatch(/Other\s*\(0\)/);
  });

  it('default active tab = first GROUP_ORDER category with bookmarks', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[2].getAttribute('aria-selected')).toBe('false');
  });

  it('skips empty leading categories to choose the first non-empty', () => {
    // Only museums present → museums tab is default.
    renderList([bm('m1', 'museum', 'TeamLab')]);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false'); // restaurants
    expect(tabs[2].getAttribute('aria-selected')).toBe('true'); // museums
  });

  it('clicking a tab updates router.replace with ?cat=…', () => {
    renderList();
    const museumsTab = screen.getAllByRole('tab')[2];
    fireEvent.click(museumsTab);
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain('cat=museum');
  });

  it('initial mount with ?cat=museum → museum tab active', () => {
    urlParams = new URLSearchParams('cat=museum');
    renderList();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
  });

  it('invalid ?cat=foo falls back to default (first non-empty)', () => {
    urlParams = new URLSearchParams('cat=foo');
    renderList();
    const tabs = screen.getAllByRole('tab');
    // Restaurant is first non-empty in SAMPLE.
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('exposes role="tablist", role="tab", and role="tabpanel"', () => {
    renderList();
    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getAllByRole('tab').length).toBe(5);
    expect(screen.getByRole('tabpanel')).toBeTruthy();
  });

  it('aria-selected reflects the active tab', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    fireEvent.click(tabs[2]);
    // After click router.replace mutates urlParams; re-render the same tree
    // by clicking again is sufficient — but with state-driven `replace` the
    // component reads urlParams on next render. Force one by re-render:
    cleanup();
    renderList();
    const after = screen.getAllByRole('tab');
    expect(after[2].getAttribute('aria-selected')).toBe('true');
  });

  it('tabIndex roving: only the active tab is tabIndex=0', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('tabindex')).toBe('0');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');
    expect(tabs[2].getAttribute('tabindex')).toBe('-1');
  });

  it('ArrowRight moves selection to the next category', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(replaceMock).toHaveBeenCalled();
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain('cat=sight');
  });

  it('ArrowLeft wraps from first to last category', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain('cat=other');
  });

  it('Home jumps to the first category', () => {
    urlParams = new URLSearchParams('cat=museum');
    renderList();
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[2], { key: 'Home' });
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain('cat=restaurant');
  });

  it('End jumps to the last category', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    fireEvent.keyDown(tabs[0], { key: 'End' });
    const lastCall = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain('cat=other');
  });

  it('empty bookmarks (zero total) → renders original empty state without tabs', () => {
    renderList([]);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText(/No bookmarks yet/i)).toBeTruthy();
  });

  it('only active panel content is rendered (museums when ?cat=museum)', () => {
    urlParams = new URLSearchParams('cat=museum');
    renderList();
    // 3 museum bookmarks
    expect(screen.getByTestId('bm-m1')).toBeTruthy();
    expect(screen.getByTestId('bm-m2')).toBeTruthy();
    expect(screen.getByTestId('bm-m3')).toBeTruthy();
    // Restaurants should not be in the panel.
    expect(screen.queryByTestId('bm-r1')).toBeNull();
  });

  it('mutating the bookmarks list (simulated delete) keeps active tab', () => {
    urlParams = new URLSearchParams('cat=museum');
    const { rerender } = renderList();
    // Remove one museum bookmark
    currentBookmarks = SAMPLE.filter((b) => b.id !== 'm2');
    rerender(
      <BookmarkList
        tripId="trip-1"
        role="editor"
        initialBookmarks={currentBookmarks}
        googlePlaceIdByPlaceId={{}}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    // Museums still active.
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');
    // m2 gone; m1 + m3 still rendered.
    expect(screen.queryByTestId('bm-m2')).toBeNull();
    expect(screen.getByTestId('bm-m1')).toBeTruthy();
    expect(screen.getByTestId('bm-m3')).toBeTruthy();
  });

  it('aria-controls on tabs points to the per-category tabpanel id', () => {
    renderList();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-controls')).toBe(
      'bookmark-tabpanel-restaurant',
    );
    expect(tabs[2].getAttribute('aria-controls')).toBe(
      'bookmark-tabpanel-museum',
    );
  });
});
