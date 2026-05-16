/**
 * @vitest-environment jsdom
 *
 * B-030 Branch B regression — ItineraryView must surface itinerary items
 * whose `day_id` is null OR points to a `trip_days` row that isn't in the
 * loaded days array. The prior behavior dropped them silently, hiding paired
 * Trello rows from the live day view even though they existed in the DB
 * (the diagnostic reported `paired_items > 0` while the UI showed `0 items`).
 *
 * These tests pin the new "Unscheduled" bucket and the day-reassign affordance.
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
  within,
} from '@testing-library/react';

// Stub Next.js Link so jsdom can render it without a router.
vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', rest as Record<string, unknown>, children),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

import { ItineraryView } from '@/components/itinerary/ItineraryView';

const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const DAY1_ID = '22222222-2222-4222-8222-222222222222';
const DAY2_ID = '33333333-3333-4333-8333-333333333333';
const STALE_DAY_ID = '99999999-9999-4999-8999-999999999999';

const trip = {
  id: TRIP_ID,
  owner_id: 'owner-1',
  name: 'Japan 2026',
  start_date: '2026-11-13',
  end_date: '2026-11-14',
  base_currency: 'JPY',
  budget: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const days = [
  {
    id: DAY1_ID,
    trip_id: TRIP_ID,
    date: '2026-11-13',
    day_number: 1,
    title: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: DAY2_ID,
    trip_id: TRIP_ID,
    date: '2026-11-14',
    day_number: 2,
    title: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

function makeItem(
  id: string,
  overrides: Partial<{
    day_id: string | null;
    title: string;
    type: 'activity' | 'meal' | 'note' | 'transport' | 'lodging';
  }> = {},
) {
  return {
    id,
    trip_id: TRIP_ID,
    day_id: overrides.day_id === undefined ? DAY1_ID : overrides.day_id,
    type: overrides.type ?? 'activity',
    title: overrides.title ?? `Item ${id}`,
    start_time: null,
    end_time: null,
    external_url: null,
    cost: null,
    currency: null,
    notes: null,
    place_id: null,
    place: null,
    created_by: 'owner-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

interface MockResponseInit {
  status?: number;
  body?: unknown;
}
function jsonResponse({ status = 200, body }: MockResponseInit): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(items: ReturnType<typeof makeItem>[]) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url === `/api/trips/${TRIP_ID}`) {
      return jsonResponse({ body: { trip, member: { role: 'owner' } } });
    }
    if (method === 'GET' && url === `/api/trips/${TRIP_ID}/days`) {
      return jsonResponse({ body: { items: days } });
    }
    if (method === 'GET' && url.startsWith(`/api/trips/${TRIP_ID}/items?`)) {
      return jsonResponse({
        body: { items, page: 1, limit: 200, total: items.length },
      });
    }
    if (method === 'GET' && url.startsWith(`/api/trips/${TRIP_ID}/transportation`)) {
      return jsonResponse({ body: { items: [], page: 1, limit: 100, total: 0 } });
    }
    if (method === 'GET' && url.startsWith(`/api/trips/${TRIP_ID}/day-indicators`)) {
      return jsonResponse({ body: { indicators: [] } });
    }
    if (method === 'GET' && url.startsWith(`/api/trips/${TRIP_ID}/days/`) && url.endsWith('/map')) {
      return jsonResponse({ body: { items: [], accommodations: [] } });
    }
    if (method === 'GET' && url.includes('/days/') && url.endsWith('/bookmarks')) {
      return jsonResponse({ body: { bookmarks: [] } });
    }
    if (method === 'PATCH' && url.startsWith(`/api/trips/${TRIP_ID}/items/`)) {
      const itemId = url.split('/').pop() ?? '';
      const body = init?.body ? (JSON.parse(String(init.body)) as { day_id?: string }) : {};
      const moved = items.find((i) => i.id === itemId);
      return jsonResponse({
        body: {
          item: { ...moved, day_id: body.day_id ?? null },
        },
      });
    }
    return jsonResponse({ status: 404, body: { error: { code: 'not_found', message: 'no mock' } } });
  });
}

describe('ItineraryView — Unscheduled bucket (B-030 Branch B)', () => {
  it('renders items with null day_id under the Unscheduled section instead of dropping them', async () => {
    const items = [
      makeItem('item-day1', { day_id: DAY1_ID, title: 'On Day 1' }),
      makeItem('item-orphan-null', { day_id: null, title: 'Orphan null' }),
    ];
    installFetch(items);

    render(<ItineraryView tripId={TRIP_ID} />);

    const section = await screen.findByTestId('unscheduled-section');
    expect(within(section).getByText('Orphan null')).toBeTruthy();
    expect(within(section).queryByText('On Day 1')).toBeNull();
  });

  it('renders items pointing to an unknown day_id under the Unscheduled section', async () => {
    const items = [
      makeItem('item-day1', { day_id: DAY1_ID, title: 'On Day 1' }),
      makeItem('item-stale', { day_id: STALE_DAY_ID, title: 'Stale day_id' }),
    ];
    installFetch(items);

    render(<ItineraryView tripId={TRIP_ID} />);

    const section = await screen.findByTestId('unscheduled-section');
    expect(within(section).getByText('Stale day_id')).toBeTruthy();
  });

  it('omits the Unscheduled section entirely when every item is correctly bucketed', async () => {
    const items = [
      makeItem('a', { day_id: DAY1_ID, title: 'A' }),
      makeItem('b', { day_id: DAY2_ID, title: 'B' }),
    ];
    installFetch(items);

    render(<ItineraryView tripId={TRIP_ID} />);
    // Wait for the loaded state — both day cards rendered.
    await screen.findByText('A');
    await screen.findByText('B');
    expect(screen.queryByTestId('unscheduled-section')).toBeNull();
  });

  it('reassigns an unscheduled item to a day via PATCH and removes it from the Unscheduled list', async () => {
    const items = [makeItem('orphan-1', { day_id: null, title: 'Needs a day' })];
    installFetch(items);

    render(<ItineraryView tripId={TRIP_ID} />);
    const section = await screen.findByTestId('unscheduled-section');

    const picker = within(section).getByLabelText(/Assign day for Needs a day/i) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: DAY2_ID } });

    await waitFor(() => {
      expect(screen.queryByTestId('unscheduled-section')).toBeNull();
    });

    // Confirm the PATCH was issued with the expected day_id.
    const patchCall = fetchMock.mock.calls.find((c) => {
      const init = c[1] as RequestInit | undefined;
      return init?.method === 'PATCH';
    });
    expect(patchCall).toBeTruthy();
    if (patchCall) {
      const init = patchCall[1] as RequestInit;
      const body = JSON.parse(String(init.body)) as { day_id: string };
      expect(body.day_id).toBe(DAY2_ID);
    }
  });
});
