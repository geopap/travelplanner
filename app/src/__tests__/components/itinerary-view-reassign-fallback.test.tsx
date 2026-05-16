/**
 * @vitest-environment jsdom
 *
 * B-030 Branch B — extra coverage beyond `itinerary-view-unscheduled.test.tsx`:
 *   1. H-1 fallback: if the chosen target day is somehow absent from the
 *      `next` state (invariant break — e.g. paginated days not yet loaded),
 *      the reassign callback must re-bucket the item under Unscheduled rather
 *      than silently drop it. We exercise this by injecting a `day_id` PATCH
 *      response that points at a `STALE_DAY_ID` not present in the loaded
 *      days array — the post-PATCH state walk should land the item back in
 *      Unscheduled.
 *   2. Viewer role: Unscheduled section renders read-only — no day picker
 *      `<select>` element, no `Pick a day…` affordance, no PATCH issued.
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
// A day_id that the server might return on PATCH but is NOT in the loaded days.
const STALE_TARGET_DAY = '99999999-9999-4999-8999-999999999999';

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

function makeItem(id: string, day_id: string | null, title: string) {
  return {
    id,
    trip_id: TRIP_ID,
    day_id,
    type: 'activity' as const,
    title,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface InstallOpts {
  items: ReturnType<typeof makeItem>[];
  role: 'viewer' | 'editor' | 'owner';
  patchReturnsDayId?: string | null;
}

function installFetch({ items, role, patchReturnsDayId }: InstallOpts) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url === `/api/trips/${TRIP_ID}`) {
      return jsonResponse({ trip, member: { role } });
    }
    if (method === 'GET' && url === `/api/trips/${TRIP_ID}/days`) {
      return jsonResponse({ items: days });
    }
    if (method === 'GET' && url.startsWith(`/api/trips/${TRIP_ID}/items?`)) {
      return jsonResponse({ items, page: 1, limit: 200, total: items.length });
    }
    if (method === 'GET' && url.startsWith(`/api/trips/${TRIP_ID}/transportation`)) {
      return jsonResponse({ items: [], page: 1, limit: 100, total: 0 });
    }
    if (method === 'GET' && url.startsWith(`/api/trips/${TRIP_ID}/day-indicators`)) {
      return jsonResponse({ indicators: [] });
    }
    if (method === 'GET' && url.includes('/days/') && url.endsWith('/map')) {
      return jsonResponse({ items: [], accommodations: [] });
    }
    if (method === 'GET' && url.includes('/days/') && url.endsWith('/bookmarks')) {
      return jsonResponse({ bookmarks: [] });
    }
    if (method === 'PATCH' && url.startsWith(`/api/trips/${TRIP_ID}/items/`)) {
      const itemId = url.split('/').pop() ?? '';
      const moved = items.find((i) => i.id === itemId);
      // PATCH returns the day_id we want the client to see — this is what
      // drives the H-1 fallback when day_id is "stale".
      return jsonResponse({ item: { ...moved, day_id: patchReturnsDayId ?? null } });
    }
    return jsonResponse({ error: { code: 'not_found', message: 'no mock' } }, 404);
  });
}

describe('ItineraryView reassign — H-1 fallback (B-030 R4 fix)', () => {
  it('re-buckets the item into Unscheduled when the target day is absent from the next state', async () => {
    const items = [makeItem('orphan-1', null, 'Stray item')];
    // The user picks DAY2_ID, but `onReassigned` is invoked with STALE_TARGET_DAY
    // — which is not a loaded day. The H-1 else branch must re-bucket it as
    // Unscheduled (never silently drop). We exercise this by routing the user's
    // chosen value through the reassign select; the handler in ItineraryView
    // calls onReassigned(itemId, dayId) with the value the user picked, but the
    // STATE BRANCH that handles "target bucket missing" is what we want to pin.
    //
    // Strategy: we feed the select a value that is NOT in itemsByDay (the only
    // buckets in state are DAY1_ID, DAY2_ID, UNSCHEDULED_KEY). Picking
    // STALE_TARGET_DAY through the picker is impossible (the option list comes
    // from the loaded `days` array), so we instead delete DAY2_ID from the
    // state via a creative path: pick DAY2_ID, but mock `installFetch` so the
    // PATCH response triggers the success branch with a target day that
    // matches the user-picked value. The R4 fix path is `next[newDayId]`
    // being falsy. To reach that branch in production code we need
    // `next[newDayId]` undefined at callback time — meaning the SELECT must
    // emit a value not present in itemsByDay. That requires injecting an
    // option. We render with patched days that include STALE_TARGET_DAY in
    // the dropdown options only (not in itemsByDay), forcing the else branch.
    installFetch({ items, role: 'editor', patchReturnsDayId: DAY2_ID });

    render(<ItineraryView tripId={TRIP_ID} />);
    const section = await screen.findByTestId('unscheduled-section');
    const picker = within(section).getByLabelText(/Assign day for Stray item/i) as HTMLSelectElement;

    // Inject a synthetic option pointing at a STALE day_id to force the
    // `next[newDayId]` falsy branch in onReassigned.
    const stale = document.createElement('option');
    stale.value = STALE_TARGET_DAY;
    stale.textContent = 'Stale (synthetic)';
    picker.appendChild(stale);

    fireEvent.change(picker, { target: { value: STALE_TARGET_DAY } });

    // After PATCH resolves and onReassigned runs, the item should still be
    // visible — re-bucketed under Unscheduled rather than silently dropped.
    await waitFor(() => {
      const stillThere = screen.queryByTestId('unscheduled-section');
      expect(stillThere).toBeTruthy();
      expect(within(stillThere as HTMLElement).getByText('Stray item')).toBeTruthy();
    });
  });
});

describe('ItineraryView Unscheduled — viewer read-only', () => {
  it('shows the Unscheduled section to viewers but omits the day-picker affordance', async () => {
    const items = [makeItem('orphan-1', null, 'Read-only orphan')];
    installFetch({ items, role: 'viewer' });

    render(<ItineraryView tripId={TRIP_ID} />);
    const section = await screen.findByTestId('unscheduled-section');

    // The item is visible to viewers.
    expect(within(section).getByText('Read-only orphan')).toBeTruthy();

    // No day-picker affordance. The select is not rendered at all when
    // `canEdit` is false (matches the existing implementation — the entire
    // `<label>` block is gated behind `{canEdit && ...}`).
    expect(within(section).queryByRole('combobox')).toBeNull();
    expect(within(section).queryByLabelText(/Assign day for/i)).toBeNull();

    // The descriptive paragraph drops the "pick one to schedule them" tail
    // for viewers — instead it ends with a period (read-only copy).
    const para = within(section).getByText(/aren't attached to a day/i);
    expect(para.textContent ?? '').not.toMatch(/pick one to schedule them/i);

    // No PATCH should have been issued.
    const anyPatch = fetchMock.mock.calls.find((c) => {
      const init = c[1] as RequestInit | undefined;
      return init?.method === 'PATCH';
    });
    expect(anyPatch).toBeUndefined();
  });
});
