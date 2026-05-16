/**
 * @vitest-environment jsdom
 *
 * B-038 — BookmarkList All/Planned/NotPlanned segmented filter tests.
 *
 * Covers segmented-control render, trip-wide split-count labels (unaffected
 * by ?cat= or active filter), URL sync via ?plan=, default `all` omitted from
 * URL, invalid ?plan= fallback, tab-count filtering, per-filter empty state
 * copy, keyboard nav, and ARIA wiring.
 */
import React from 'react';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
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

// --- useBookmarks: drive list from currentBookmarks ---------------------
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

// --- Stub child components --------------------------------------------
vi.mock('@/components/bookmarks/BookmarkItem', () => ({
  BookmarkItem: ({ bookmark }: { bookmark: Bookmark }) => (
    <li data-testid={`bm-${bookmark.id}`}>
      {bookmark.place?.name ?? '(no name)'}
    </li>
  ),
}));
vi.mock('@/components/bookmarks/BookmarkForm', () => ({
  BookmarkForm: () => null,
}));
vi.mock('@/components/bookmarks/BookmarkDeleteDialog', () => ({
  BookmarkDeleteDialog: () => null,
}));
vi.mock('@/components/places/AddPlaceDialog', () => ({
  AddPlaceDialog: () => null,
}));
vi.mock('@/components/itinerary/AddToItineraryDialog', () => ({
  AddToItineraryDialog: () => null,
}));

import { BookmarkList } from '@/components/bookmarks/BookmarkList';

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

// 6 bookmarks across 3 categories; 3 planned, 3 not.
const SAMPLE: Bookmark[] = [
  bm('r1', 'restaurant', 'Sushi Saito'),
  bm('r2', 'restaurant', 'Ramen Ichi'),
  bm('s1', 'sight', 'Tokyo Tower'),
  bm('s2', 'sight', 'Senso-ji'),
  bm('m1', 'museum', 'Edo Museum'),
  bm('m2', 'museum', 'TeamLab'),
];

const PLANNED_MAP: Record<string, boolean> = {
  r1: true,
  r2: false,
  s1: true,
  s2: false,
  m1: true,
  m2: false,
};

const SPLIT = { all: 6, planned: 3, notPlanned: 3 };

function renderList(opts?: {
  bookmarks?: Bookmark[];
  planned?: Record<string, boolean>;
  split?: { all: number; planned: number; notPlanned: number };
}) {
  const bookmarks = opts?.bookmarks ?? SAMPLE;
  currentBookmarks = bookmarks;
  return render(
    <BookmarkList
      tripId="trip-1"
      role="editor"
      initialBookmarks={bookmarks}
      googlePlaceIdByPlaceId={{}}
      plannedByBookmarkId={opts?.planned ?? PLANNED_MAP}
      planSplitCounts={opts?.split ?? SPLIT}
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

describe('BookmarkList plan filter (B-038)', () => {
  it('renders the segmented control with three radio options', () => {
    renderList();
    const group = screen.getByRole('radiogroup', {
      name: /filter by planned status/i,
    });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
  });

  it('segmented-control labels include trip-wide split counts', () => {
    renderList();
    expect(screen.getByTestId('plan-filter-all').textContent).toMatch(
      /All\s*\(6\)/,
    );
    expect(screen.getByTestId('plan-filter-planned').textContent).toMatch(
      /Planned\s*\(3\)/,
    );
    expect(screen.getByTestId('plan-filter-notplanned').textContent).toMatch(
      /Not Planned\s*\(3\)/,
    );
  });

  it('default active = All when no ?plan= is set', () => {
    renderList();
    const allBtn = screen.getByTestId('plan-filter-all');
    expect(allBtn.getAttribute('aria-checked')).toBe('true');
    expect(allBtn.getAttribute('tabindex')).toBe('0');
  });

  it('initial mount with ?plan=planned → planned active', () => {
    urlParams = new URLSearchParams('plan=planned');
    renderList();
    expect(
      screen.getByTestId('plan-filter-planned').getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByTestId('plan-filter-all').getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('invalid ?plan=foo falls back to all', () => {
    urlParams = new URLSearchParams('plan=foo');
    renderList();
    expect(
      screen.getByTestId('plan-filter-all').getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('clicking Planned writes ?plan=planned to URL', () => {
    renderList();
    fireEvent.click(screen.getByTestId('plan-filter-planned'));
    const last = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('plan=planned');
  });

  it('clicking All omits plan from URL (clean default)', () => {
    urlParams = new URLSearchParams('plan=planned');
    renderList();
    fireEvent.click(screen.getByTestId('plan-filter-all'));
    const last = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(last).not.toContain('plan=');
  });

  it('combines cleanly with existing ?cat= param', () => {
    urlParams = new URLSearchParams('cat=museum');
    renderList();
    fireEvent.click(screen.getByTestId('plan-filter-notplanned'));
    const last = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('cat=museum');
    expect(last).toContain('plan=notplanned');
  });

  it('tab counts respect active filter (plan=planned shows planned-only counts)', () => {
    urlParams = new URLSearchParams('plan=planned');
    renderList();
    const tabs = screen.getAllByRole('tab');
    // Only r1/s1/m1 are planned — one per category.
    expect(tabs[0].textContent).toMatch(/Restaurants\s*\(1\)/);
    expect(tabs[1].textContent).toMatch(/Sights\s*\(1\)/);
    expect(tabs[2].textContent).toMatch(/Museums\s*\(1\)/);
  });

  it('tab counts respect plan=notplanned filter', () => {
    urlParams = new URLSearchParams('plan=notplanned');
    renderList();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].textContent).toMatch(/Restaurants\s*\(1\)/);
    expect(tabs[1].textContent).toMatch(/Sights\s*\(1\)/);
    expect(tabs[2].textContent).toMatch(/Museums\s*\(1\)/);
  });

  it('panel renders only filtered bookmarks (plan=planned, cat=restaurant)', () => {
    urlParams = new URLSearchParams('cat=restaurant&plan=planned');
    renderList();
    expect(screen.getByTestId('bm-r1')).toBeTruthy();
    expect(screen.queryByTestId('bm-r2')).toBeNull();
  });

  it('per-filter empty-state copy when active category has 0 under filter', () => {
    // Make restaurants all unplanned. Active cat = restaurant via ?cat=.
    urlParams = new URLSearchParams('cat=restaurant&plan=planned');
    renderList({
      planned: { ...PLANNED_MAP, r1: false }, // now both restaurants unplanned
    });
    expect(
      screen.getByText(/No restaurants are planned yet\./i),
    ).toBeTruthy();
  });

  it('per-filter empty state for not-planned', () => {
    urlParams = new URLSearchParams('cat=restaurant&plan=notplanned');
    renderList({
      planned: { ...PLANNED_MAP, r1: true, r2: true },
    });
    expect(
      screen.getByText(/No restaurants are not planned yet\./i),
    ).toBeTruthy();
  });

  it('does NOT auto-switch tabs when active category empties under filter', () => {
    urlParams = new URLSearchParams('cat=restaurant&plan=planned');
    renderList({ planned: { ...PLANNED_MAP, r1: false } });
    // Restaurants tab remains aria-selected even though it's empty.
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('split counts in segmented labels are NOT affected by ?cat=', () => {
    urlParams = new URLSearchParams('cat=museum');
    renderList();
    expect(screen.getByTestId('plan-filter-all').textContent).toMatch(
      /All\s*\(6\)/,
    );
    expect(screen.getByTestId('plan-filter-planned').textContent).toMatch(
      /Planned\s*\(3\)/,
    );
  });

  it('split counts in segmented labels are NOT affected by active plan filter', () => {
    urlParams = new URLSearchParams('plan=planned');
    renderList();
    // Even when only planned shown, the "Not Planned" label still says (3).
    expect(screen.getByTestId('plan-filter-notplanned').textContent).toMatch(
      /Not Planned\s*\(3\)/,
    );
  });

  it('roving tabindex: only active radio is tabIndex=0', () => {
    renderList();
    expect(screen.getByTestId('plan-filter-all').getAttribute('tabindex')).toBe(
      '0',
    );
    expect(
      screen.getByTestId('plan-filter-planned').getAttribute('tabindex'),
    ).toBe('-1');
    expect(
      screen.getByTestId('plan-filter-notplanned').getAttribute('tabindex'),
    ).toBe('-1');
  });

  it('ArrowRight moves the segmented selection to the next option', () => {
    renderList();
    fireEvent.keyDown(screen.getByTestId('plan-filter-all'), {
      key: 'ArrowRight',
    });
    const last = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('plan=planned');
  });

  it('ArrowLeft wraps from All to Not Planned', () => {
    renderList();
    fireEvent.keyDown(screen.getByTestId('plan-filter-all'), {
      key: 'ArrowLeft',
    });
    const last = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('plan=notplanned');
  });

  it('End jumps to the last option (Not Planned)', () => {
    renderList();
    fireEvent.keyDown(screen.getByTestId('plan-filter-all'), { key: 'End' });
    const last = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('plan=notplanned');
  });

  it('Home jumps from a non-default option back to All (clears ?plan=)', () => {
    urlParams = new URLSearchParams('plan=notplanned');
    renderList();
    fireEvent.keyDown(screen.getByTestId('plan-filter-notplanned'), {
      key: 'Home',
    });
    const last = replaceMock.mock.calls.at(-1)?.[0] as string;
    expect(last).not.toContain('plan=');
  });

  it('segmented control is placed below the tablist in DOM order', () => {
    renderList();
    const tablist = screen.getByRole('tablist');
    const radiogroup = screen.getByRole('radiogroup', {
      name: /filter by planned status/i,
    });
    // compareDocumentPosition: tablist precedes radiogroup
    const pos = tablist.compareDocumentPosition(radiogroup);
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    expect(pos & 4).toBe(4);
  });
});
