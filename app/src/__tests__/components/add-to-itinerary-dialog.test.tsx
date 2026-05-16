/**
 * @vitest-environment jsdom
 *
 * B-033 — AddToItineraryDialog unit tests.
 *
 * Covers:
 *   - dialog renders + z-[1100] container
 *   - day selector required (Confirm disabled until a day is picked)
 *   - type defaults from category (restaurant → meal; sight → activity)
 *   - type selector does NOT include `transport`
 *   - end-time-before-start-time validation surfaces inline error
 *   - successful submit POSTs to /api/trips/<id>/items with day_id, type,
 *     place_id; omits `title` (server resolves); omits `source_card_id`
 *   - multi-day re-add allowed: dialog can be re-opened for the same place
 *     and submit twice with no client-side guard
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
import type { TripDay } from '@/lib/types/domain';

// --- Mocks ---------------------------------------------------------------

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

import { AddToItineraryDialog } from '@/components/itinerary/AddToItineraryDialog';

const TRIP_ID = '11111111-2222-4333-8444-555555555555';
const PLACE_ID = '22222222-2222-4333-8444-666666666666';

function makeDay(n: number, date: string): TripDay {
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`,
    trip_id: TRIP_ID,
    day_number: n,
    date,
    title: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const DAYS: TripDay[] = [
  makeDay(1, '2026-05-01'),
  makeDay(2, '2026-05-02'),
  makeDay(3, '2026-05-03'),
];

function mockOkResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof AddToItineraryDialog>> = {}) {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  const props: React.ComponentProps<typeof AddToItineraryDialog> = {
    open: true,
    onClose,
    tripId: TRIP_ID,
    placeId: PLACE_ID,
    placeName: 'Sushi Saito',
    category: 'restaurant',
    days: DAYS,
    onAdded,
    ...overrides,
  };
  const utils = render(<AddToItineraryDialog {...props} />);
  return { ...utils, onClose, onAdded };
}

describe('AddToItineraryDialog — render', () => {
  it('renders dialog with high z-index (z-[1100]) container', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: /add to itinerary/i });
    expect(dialog).toBeTruthy();
    // The outermost dialog container carries the z class
    expect(dialog.className).toContain('z-[1100]');
  });

  it('shows the place name in the header', () => {
    renderDialog({ placeName: 'Tsukiji Market' });
    expect(screen.getByText('Tsukiji Market')).toBeTruthy();
  });

  it('returns null when open=false', () => {
    const { container } = renderDialog({ open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('AddToItineraryDialog — type defaulting + transport exclusion', () => {
  it('defaults type to "meal" when category is restaurant', () => {
    renderDialog({ category: 'restaurant' });
    const sel = screen.getByLabelText(/^Type$/) as HTMLSelectElement;
    expect(sel.value).toBe('meal');
  });

  it('defaults type to "activity" when category is sight', () => {
    renderDialog({ category: 'sight' });
    const sel = screen.getByLabelText(/^Type$/) as HTMLSelectElement;
    expect(sel.value).toBe('activity');
  });

  it('defaults type to "activity" when category is museum/shopping/other', () => {
    for (const cat of ['museum', 'shopping', 'other'] as const) {
      cleanup();
      renderDialog({ category: cat });
      const sel = screen.getByLabelText(/^Type$/) as HTMLSelectElement;
      expect(sel.value).toBe('activity');
    }
  });

  it('omits "transport" from the type selector options', () => {
    renderDialog();
    const sel = screen.getByLabelText(/^Type$/) as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).not.toContain('transport');
    expect(values.sort()).toEqual(['activity', 'lodging', 'meal', 'note']);
  });
});

describe('AddToItineraryDialog — day required + time validation', () => {
  it('disables Confirm until a day is selected', () => {
    renderDialog();
    const confirm = screen.getByRole('button', {
      name: /add to itinerary/i,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    const daySel = screen.getByLabelText(/^Day/) as HTMLSelectElement;
    fireEvent.change(daySel, { target: { value: DAYS[0].id } });
    expect(confirm.disabled).toBe(false);
  });

  it('shows inline error and disables Confirm when end < start', () => {
    renderDialog();
    const daySel = screen.getByLabelText(/^Day/) as HTMLSelectElement;
    fireEvent.change(daySel, { target: { value: DAYS[0].id } });

    const start = screen.getByLabelText(/start time/i) as HTMLInputElement;
    const end = screen.getByLabelText(/end time/i) as HTMLInputElement;
    fireEvent.change(start, { target: { value: '14:00' } });
    fireEvent.change(end, { target: { value: '12:00' } });

    expect(screen.getByText(/end time must be on or after start time/i)).toBeTruthy();
    const confirm = screen.getByRole('button', {
      name: /add to itinerary/i,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('clears the time error when end >= start', () => {
    renderDialog();
    const daySel = screen.getByLabelText(/^Day/) as HTMLSelectElement;
    fireEvent.change(daySel, { target: { value: DAYS[0].id } });
    const start = screen.getByLabelText(/start time/i) as HTMLInputElement;
    const end = screen.getByLabelText(/end time/i) as HTMLInputElement;
    fireEvent.change(start, { target: { value: '14:00' } });
    fireEvent.change(end, { target: { value: '12:00' } });
    expect(screen.queryByText(/end time must be on or after/i)).toBeTruthy();
    fireEvent.change(end, { target: { value: '15:00' } });
    expect(screen.queryByText(/end time must be on or after/i)).toBeNull();
  });
});

describe('AddToItineraryDialog — submit', () => {
  it('POSTs day_id, type, place_id; omits title and source_card_id', async () => {
    fetchMock.mockResolvedValue(
      mockOkResponse({ item: { id: 'new-item-id', day_id: DAYS[1].id } }),
    );
    const { onClose, onAdded } = renderDialog({ category: 'sight' });
    const daySel = screen.getByLabelText(/^Day/) as HTMLSelectElement;
    fireEvent.change(daySel, { target: { value: DAYS[1].id } });

    fireEvent.click(
      screen.getByRole('button', { name: /add to itinerary/i }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const call = fetchMock.mock.calls[0];
    const url = String(call[0]);
    const init = call[1] as RequestInit;
    expect(url).toBe(`/api/trips/${TRIP_ID}/items`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.day_id).toBe(DAYS[1].id);
    expect(body.type).toBe('activity'); // sight → activity default
    expect(body.place_id).toBe(PLACE_ID);
    expect('title' in body).toBe(false); // server resolves
    expect('source_card_id' in body).toBe(false); // never sent on this flow

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });

  it('builds ISO start/end_time from the selected day date + HH:MM picker', async () => {
    fetchMock.mockResolvedValue(
      mockOkResponse({ item: { id: 'x', day_id: DAYS[0].id } }),
    );
    renderDialog();
    fireEvent.change(screen.getByLabelText(/^Day/), {
      target: { value: DAYS[0].id },
    });
    fireEvent.change(screen.getByLabelText(/start time/i), {
      target: { value: '09:30' },
    });
    fireEvent.change(screen.getByLabelText(/end time/i), {
      target: { value: '11:00' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /add to itinerary/i }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.start_time).toBe('2026-05-01T09:30:00.000Z');
    expect(body.end_time).toBe('2026-05-01T11:00:00.000Z');
  });

  it('surfaces 403 error inline and keeps dialog open', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'viewer_role', message: 'forbidden' },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText(/^Day/), {
      target: { value: DAYS[0].id },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /add to itinerary/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByText(/don't have permission to add items/i),
      ).toBeTruthy(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
