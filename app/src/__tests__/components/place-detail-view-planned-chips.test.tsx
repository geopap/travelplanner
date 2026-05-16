/**
 * @vitest-environment jsdom
 *
 * B-032 — "Planned on dd.mm.yyyy" chip group on `PlaceDetailView`. We assert:
 *   - chip group renders when `plannedDays` is non-empty and a trip context is set
 *   - nothing renders when the array is empty, undefined, or no trip context
 *   - each chip links to `/trips/<tripContextId>/itinerary#day-<dayNumber>`
 *   - the chip label is exactly `Planned on dd.mm.yyyy`
 *   - multi-day chips render in the order passed
 *
 * Heavy children (PhotoGallery, PlaceMiniMap, BookmarkButton) are mocked so
 * the test stays focused on the chip surface and does not require Leaflet or
 * a live image origin.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Stub: React.FC = () => <div data-testid="dynamic-stub" />;
    return Stub;
  },
}));

vi.mock('@/components/places/PhotoGallery', () => ({
  PhotoGallery: () => <div data-testid="photo-gallery-stub" />,
}));

vi.mock('@/components/places/PlaceMiniMap', () => ({
  PlaceMiniMap: () => <div data-testid="mini-map-stub" />,
}));

vi.mock('@/components/places/RelinkTriggerPill', () => ({
  RelinkTriggerPill: () => <div data-testid="relink-pill-stub" />,
}));

vi.mock('@/components/places/CopyAddressButton', () => ({
  CopyAddressButton: () => <button type="button">Copy</button>,
}));

import type { PlaceDetail } from '@/lib/types/domain';
import { PlaceDetailView } from '@/components/places/PlaceDetailView';

const TRIP_ID = '11111111-2222-3333-4444-555555555555';

function makeDetail(overrides: Partial<PlaceDetail> = {}): PlaceDetail {
  return {
    google_place_id: 'ChIJexample',
    name: 'Sushi Saito',
    category: 'restaurant',
    rating: 4.6,
    user_ratings_total: 1200,
    formatted_address: '1 Chome Akasaka, Minato',
    phone: null,
    website: null,
    lat: 35.67,
    lng: 139.73,
    opening_hours: null,
    photos: [],
    source: 'api',
    ...overrides,
  } as PlaceDetail;
}

describe('PlaceDetailView — Planned-on chips (B-032)', () => {
  afterEach(() => cleanup());

  it('renders one chip per planned day with the canonical "Planned on dd.mm.yyyy" label', () => {
    render(
      <PlaceDetailView
        detail={makeDetail()}
        tripContextId={TRIP_ID}
        plannedDays={[
          { dayNumber: 3, formattedDate: '14.07.2026' },
          { dayNumber: 7, formattedDate: '18.07.2026' },
        ]}
      />,
    );

    const nav = screen.getByTestId('planned-on-chips');
    expect(nav.getAttribute('aria-label')).toBe(
      'Scheduled days for this place',
    );
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('Planned on 14.07.2026');
    expect(links[1].textContent).toBe('Planned on 18.07.2026');
  });

  it('builds chip links as /trips/<tripContextId>/itinerary#day-<dayNumber>', () => {
    render(
      <PlaceDetailView
        detail={makeDetail()}
        tripContextId={TRIP_ID}
        plannedDays={[{ dayNumber: 5, formattedDate: '16.07.2026' }]}
      />,
    );
    const link = screen.getByRole('link', { name: /planned on 16\.07\.2026/i });
    expect(link.getAttribute('href')).toBe(
      `/trips/${TRIP_ID}/itinerary#day-5`,
    );
  });

  it('preserves the order of the plannedDays array', () => {
    render(
      <PlaceDetailView
        detail={makeDetail()}
        tripContextId={TRIP_ID}
        plannedDays={[
          { dayNumber: 2, formattedDate: '10.07.2026' },
          { dayNumber: 1, formattedDate: '09.07.2026' },
          { dayNumber: 9, formattedDate: '20.07.2026' },
        ]}
      />,
    );
    const labels = screen
      .getAllByRole('link')
      .filter((el) => /^Planned on /.test(el.textContent ?? ''))
      .map((el) => el.textContent);
    expect(labels).toEqual([
      'Planned on 10.07.2026',
      'Planned on 09.07.2026',
      'Planned on 20.07.2026',
    ]);
  });

  it('renders nothing when plannedDays is an empty array', () => {
    render(
      <PlaceDetailView
        detail={makeDetail()}
        tripContextId={TRIP_ID}
        plannedDays={[]}
      />,
    );
    expect(screen.queryByTestId('planned-on-chips')).toBeNull();
    expect(
      screen.queryByText(/^Planned on /i),
    ).toBeNull();
  });

  it('renders nothing when plannedDays is undefined', () => {
    render(
      <PlaceDetailView detail={makeDetail()} tripContextId={TRIP_ID} />,
    );
    expect(screen.queryByTestId('planned-on-chips')).toBeNull();
  });

  it('renders nothing when there is no trip context, even if plannedDays is populated', () => {
    render(
      <PlaceDetailView
        detail={makeDetail()}
        plannedDays={[{ dayNumber: 3, formattedDate: '14.07.2026' }]}
      />,
    );
    expect(screen.queryByTestId('planned-on-chips')).toBeNull();
    expect(screen.queryByText(/^Planned on /i)).toBeNull();
  });
});
