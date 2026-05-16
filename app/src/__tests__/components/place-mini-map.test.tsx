/**
 * @vitest-environment jsdom
 *
 * B-027 — PlaceMiniMap unit tests. We assert placeholder rendering when
 * lat/lng are missing and the framed container when coords are present.
 * The Leaflet rendering itself is owned by PlaceMiniMapInner (dynamic, ssr:false)
 * and is out of scope here — we mock `next/dynamic` to a stub child.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// Replace next/dynamic with a sync stub so we don't need to evaluate Leaflet.
vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Stub: React.FC<{
      lat: number;
      lng: number;
      name: string;
      formattedAddress: string | null;
    }> = ({ lat, lng, name }) => (
      <div
        data-testid="mini-map-inner"
        data-lat={lat}
        data-lng={lng}
        data-name={name}
      />
    );
    return Stub;
  },
}));

// Import after mock so the dynamic() call resolves to our stub.
import { PlaceMiniMap } from '@/components/places/PlaceMiniMap';

describe('PlaceMiniMap (B-027)', () => {
  afterEach(() => cleanup());

  it('renders placeholder when lat is null', () => {
    render(
      <PlaceMiniMap
        lat={null}
        lng={139.7}
        name="Tokyo Tower"
        formattedAddress={null}
      />,
    );
    const placeholder = screen.getByRole('img', {
      name: /map unavailable for this place/i,
    });
    expect(placeholder).toBeTruthy();
    expect(screen.getByText(/map unavailable/i)).toBeTruthy();
  });

  it('renders placeholder when lng is null', () => {
    render(
      <PlaceMiniMap
        lat={35.6}
        lng={null}
        name="Tokyo Tower"
        formattedAddress={null}
      />,
    );
    expect(
      screen.getByRole('img', { name: /map unavailable for this place/i }),
    ).toBeTruthy();
  });

  it('renders placeholder when both coords are null', () => {
    render(
      <PlaceMiniMap
        lat={null}
        lng={null}
        name="Tokyo Tower"
        formattedAddress="1 Chome-1 Shibakoen"
      />,
    );
    expect(
      screen.getByRole('img', { name: /map unavailable for this place/i }),
    ).toBeTruthy();
  });

  it('placeholder exposes role="img" and an aria-label', () => {
    render(
      <PlaceMiniMap lat={null} lng={null} name="X" formattedAddress={null} />,
    );
    const placeholder = screen.getByRole('img');
    expect(placeholder.getAttribute('aria-label')).toBe(
      'Map unavailable for this place',
    );
  });

  it('renders the dynamic inner map when both coords are present', () => {
    render(
      <PlaceMiniMap
        lat={35.6586}
        lng={139.7454}
        name="Tokyo Tower"
        formattedAddress="1 Chome-1 Shibakoen"
      />,
    );
    const inner = screen.getByTestId('mini-map-inner');
    expect(inner).toBeTruthy();
    expect(inner.getAttribute('data-lat')).toBe('35.6586');
    expect(inner.getAttribute('data-lng')).toBe('139.7454');
    expect(inner.getAttribute('data-name')).toBe('Tokyo Tower');
    // Placeholder should not be present
    expect(screen.queryByRole('img', { name: /map unavailable/i })).toBeNull();
  });
});
