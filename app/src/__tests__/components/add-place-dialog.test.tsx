/**
 * @vitest-environment jsdom
 *
 * B-037 — AddPlaceDialog unit tests.
 *
 * Covers: dialog render + z-index, viewer hides the trigger (BookmarkList
 * integration), successful submit flow (place pre-hydration + POST), 409
 * `bookmark_exists` inline error keeps the dialog open, generic submit error
 * keeps the dialog open with mapped copy.
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
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import type { Bookmark } from '@/lib/types/domain';

// --- Mocks ---------------------------------------------------------------

// next/navigation (BookmarkList consumes useRouter/useSearchParams).
let urlParams = new URLSearchParams();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => urlParams,
  usePathname: () => '/trips/trip-1/places',
}));

// useBookmarks for BookmarkList rendering paths.
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

// Stub child components that pull in heavy deps.
vi.mock('@/components/bookmarks/BookmarkItem', () => ({
  BookmarkItem: () => null,
}));
vi.mock('@/components/bookmarks/BookmarkForm', () => ({
  BookmarkForm: () => null,
}));
vi.mock('@/components/bookmarks/BookmarkDeleteDialog', () => ({
  BookmarkDeleteDialog: () => null,
}));

// PlaceSearchInput: lightweight stub with a "pick" button that fires onSelect
// with a deterministic place. Avoids hitting the search proxy or any timers.
vi.mock('@/components/places/PlaceSearchInput', () => ({
  PlaceSearchInput: ({
    onSelect,
  }: {
    onSelect: (p: {
      google_place_id: string;
      name: string;
      formatted_address: string | null;
      category: string;
      lat: number | null;
      lng: number | null;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-pick-place"
      onClick={() =>
        onSelect({
          google_place_id: 'place-xyz',
          name: 'Sushi Saito',
          formatted_address: '1-4-5 Roppongi, Tokyo',
          category: 'restaurant',
          lat: 35.6,
          lng: 139.7,
        })
      }
    >
      mock-pick
    </button>
  ),
}));

// apiFetch — toggled per test. Mock factory is hoisted, so the error class
// must be defined inside the factory (or via vi.hoisted).
const apiFetchMock = vi.fn();
vi.mock('@/lib/utils/api-client', () => {
  class ApiClientErrorStub extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
    ApiClientError: ApiClientErrorStub,
  };
});

// Re-import the mocked class so tests can construct it.
import { ApiClientError as ApiClientErrorStub } from '@/lib/utils/api-client';

import { AddPlaceDialog } from '@/components/places/AddPlaceDialog';
import { BookmarkList } from '@/components/bookmarks/BookmarkList';

// --- Helpers -------------------------------------------------------------

function renderDialog(props?: Partial<React.ComponentProps<typeof AddPlaceDialog>>) {
  const onClose = props?.onClose ?? vi.fn();
  const onAdded = props?.onAdded ?? vi.fn();
  return {
    onClose,
    onAdded,
    ...render(
      <AddPlaceDialog
        open
        onClose={onClose}
        tripId="trip-1"
        defaultCategory="restaurant"
        onAdded={onAdded}
        {...props}
      />,
    ),
  };
}

function bookmarkFactory(): Bookmark {
  return {
    id: 'bm-new',
    trip_id: 'trip-1',
    place_id: 'place-uuid-xyz',
    category: 'restaurant',
    notes: null,
    added_by: 'user-1',
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    place: {
      name: 'Sushi Saito',
      formatted_address: '1-4-5 Roppongi, Tokyo',
      category: 'restaurant',
      lat: 35.6,
      lng: 139.7,
    },
  };
}

beforeEach(() => {
  urlParams = new URLSearchParams();
  replaceMock.mockClear();
  refetchMock.mockClear();
  apiFetchMock.mockReset();
  currentBookmarks = [];
});

afterEach(() => {
  cleanup();
});

describe('AddPlaceDialog (B-037)', () => {
  it('renders a dialog with z-[1100] (above Leaflet stack)', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.className).toContain('z-[1100]');
    expect(screen.getByText('Add a place')).toBeTruthy();
  });

  it('does not render when open=false', () => {
    render(
      <AddPlaceDialog
        open={false}
        onClose={vi.fn()}
        tripId="trip-1"
        onAdded={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables submit until a place is picked', () => {
    renderDialog();
    const submit = screen.getByRole('button', { name: /add place/i });
    expect(submit.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByTestId('mock-pick-place'));
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('successful submit: pre-hydrates place, POSTs bookmark, calls onAdded', async () => {
    const bookmark = bookmarkFactory();
    apiFetchMock
      .mockResolvedValueOnce({}) // GET /api/places/[id]
      .mockResolvedValueOnce({ bookmark }); // POST /api/trips/.../bookmarks

    const { onAdded } = renderDialog();
    fireEvent.click(screen.getByTestId('mock-pick-place'));
    fireEvent.click(screen.getByRole('button', { name: /add place/i }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(bookmark));

    // First call: GET /api/places/place-xyz
    const firstCall = apiFetchMock.mock.calls[0];
    expect(firstCall[0]).toBe('/api/places/place-xyz');
    expect(firstCall[1]).toEqual({ method: 'GET' });

    // Second call: POST bookmark with our payload.
    const secondCall = apiFetchMock.mock.calls[1];
    expect(secondCall[0]).toBe('/api/trips/trip-1/bookmarks');
    expect(secondCall[1]).toMatchObject({
      method: 'POST',
      body: {
        google_place_id: 'place-xyz',
        category: 'restaurant',
      },
    });
  });

  it('409 bookmark_exists: surfaces inline error and dialog stays open', async () => {
    apiFetchMock
      .mockResolvedValueOnce({}) // GET pre-hydrate
      .mockRejectedValueOnce(
        new ApiClientErrorStub(409, 'bookmark_exists', 'duplicate'),
      );

    const { onAdded, onClose } = renderDialog();
    fireEvent.click(screen.getByTestId('mock-pick-place'));
    fireEvent.click(screen.getByRole('button', { name: /add place/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(
        /already bookmarked/i,
      ),
    );
    expect(onAdded).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Dialog still open.
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Submit button re-enabled so user can pick a different category/place.
    expect(
      screen.getByRole('button', { name: /add place/i }).hasAttribute(
        'disabled',
      ),
    ).toBe(false);
  });

  it('generic error: maps to user-facing copy and keeps dialog open', async () => {
    apiFetchMock
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new ApiClientErrorStub(500, 'unknown', 'boom'),
      );

    renderDialog();
    fireEvent.click(screen.getByTestId('mock-pick-place'));
    fireEvent.click(screen.getByRole('button', { name: /add place/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('BookmarkList × AddPlaceDialog integration (B-037)', () => {
  it('viewer role does NOT see the "Add a place" button (empty state)', () => {
    currentBookmarks = [];
    render(
      <BookmarkList
        tripId="trip-1"
        role="viewer"
        initialBookmarks={[]}
        googlePlaceIdByPlaceId={{}}
      />,
    );
    expect(screen.queryByRole('button', { name: /add a place/i })).toBeNull();
  });

  it('editor role sees the "Add a place" button in the empty state', () => {
    currentBookmarks = [];
    render(
      <BookmarkList
        tripId="trip-1"
        role="editor"
        initialBookmarks={[]}
        googlePlaceIdByPlaceId={{}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /add a place/i }),
    ).toBeTruthy();
  });

  it('editor sees the "Add a place" button above the tablist when bookmarks exist', () => {
    currentBookmarks = [
      {
        id: 'bm-1',
        trip_id: 'trip-1',
        place_id: 'p-1',
        category: 'restaurant',
        notes: null,
        added_by: 'u-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        place: {
          name: 'Ramen Ichi',
          formatted_address: null,
          category: 'restaurant',
          lat: null,
          lng: null,
        },
      },
    ];
    render(
      <BookmarkList
        tripId="trip-1"
        role="editor"
        initialBookmarks={currentBookmarks}
        googlePlaceIdByPlaceId={{}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /add a place/i }),
    ).toBeTruthy();
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('viewer never sees the button even when bookmarks exist', () => {
    currentBookmarks = [
      {
        id: 'bm-1',
        trip_id: 'trip-1',
        place_id: 'p-1',
        category: 'restaurant',
        notes: null,
        added_by: 'u-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        place: {
          name: 'Ramen Ichi',
          formatted_address: null,
          category: 'restaurant',
          lat: null,
          lng: null,
        },
      },
    ];
    render(
      <BookmarkList
        tripId="trip-1"
        role="viewer"
        initialBookmarks={currentBookmarks}
        googlePlaceIdByPlaceId={{}}
      />,
    );
    expect(screen.queryByRole('button', { name: /add a place/i })).toBeNull();
  });
});
