/**
 * @vitest-environment jsdom
 *
 * Cross-item smoke: PlaceDetailView under B-032 (planned-on chips) AND B-033
 * (Add to Itinerary pill) at the same time. Each item has its own focused
 * test file; this guards against a regression where rendering both together
 * causes layout drift, missing surfaces, or DOM-order collisions.
 *
 * We assert:
 *   - The chip nav (`planned-on-chips`) is in the document.
 *   - The Add-to-Itinerary trigger pill is in the document.
 *   - The pill is rendered EARLIER in document order than the chip nav
 *     (matches the structural contract from SPRINT.md R3 notes: pill lives
 *     in the action row at L138–171; chips live in the sibling nav block at
 *     L192–208).
 *   - Both surfaces stay rendered together — the pill is not hidden by the
 *     chip group and vice versa.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('a', rest as Record<string, unknown>, children),
}));

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
  RelinkTriggerPill: () => <span data-testid="relink-pill-stub">Relink</span>,
}));

vi.mock('@/components/itinerary/AddToItineraryTriggerPill', () => ({
  AddToItineraryTriggerPill: () => (
    <button type="button" data-testid="add-to-itinerary-pill">
      Add to itinerary
    </button>
  ),
}));

vi.mock('@/components/places/CopyAddressButton', () => ({
  CopyAddressButton: () => <button type="button">Copy</button>,
}));

import type { PlaceDetail } from '@/lib/types/domain';
import { PlaceDetailView } from '@/components/places/PlaceDetailView';

const TRIP_ID = '11111111-2222-3333-4444-555555555555';
const PLACE_UUID = '99999999-8888-4777-8666-555555555555';

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

describe('PlaceDetailView — B-032 chips + B-033 pill coexistence', () => {
  afterEach(() => cleanup());

  it('renders the Add-to-Itinerary pill AND the planned-on chip nav together', () => {
    render(
      <PlaceDetailView
        detail={makeDetail()}
        tripId={TRIP_ID}
        canRelink
        fromPlaceId={PLACE_UUID}
        tripContextId={TRIP_ID}
        plannedDays={[
          { dayNumber: 3, formattedDate: '14.07.2026' },
          { dayNumber: 7, formattedDate: '18.07.2026' },
        ]}
      />,
    );

    const pill = screen.getByTestId('add-to-itinerary-pill');
    const chipNav = screen.getByTestId('planned-on-chips');

    expect(pill).toBeTruthy();
    expect(chipNav).toBeTruthy();

    // Both chips visible.
    expect(screen.getByText(/Planned on 14\.07\.2026/)).toBeTruthy();
    expect(screen.getByText(/Planned on 18\.07\.2026/)).toBeTruthy();

    // Structural contract: the pill row precedes the chip nav in document
    // order (pill sits in the action row alongside Google Maps + Re-link;
    // chip nav is the sibling block immediately below).
    const cmp = pill.compareDocumentPosition(chipNav);
    expect(cmp & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the chip nav without the pill when trip cannot be re-linked', () => {
    // canRelink=false → the pill is gated off, but the chip nav is still
    // shown because chip rendering depends only on tripContextId + plannedDays.
    render(
      <PlaceDetailView
        detail={makeDetail()}
        tripContextId={TRIP_ID}
        plannedDays={[{ dayNumber: 1, formattedDate: '01.01.2026' }]}
      />,
    );

    expect(screen.queryByTestId('add-to-itinerary-pill')).toBeNull();
    expect(screen.getByTestId('planned-on-chips')).toBeTruthy();
  });

  it('renders the pill without the chip nav when no plannedDays', () => {
    render(
      <PlaceDetailView
        detail={makeDetail()}
        tripId={TRIP_ID}
        canRelink
        fromPlaceId={PLACE_UUID}
        tripContextId={TRIP_ID}
        plannedDays={[]}
      />,
    );

    expect(screen.getByTestId('add-to-itinerary-pill')).toBeTruthy();
    expect(screen.queryByTestId('planned-on-chips')).toBeNull();
  });
});
