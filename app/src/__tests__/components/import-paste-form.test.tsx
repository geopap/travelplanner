/**
 * @vitest-environment jsdom
 *
 * B-035 — ImportPasteForm caption-mode banner unit tests.
 *
 * Covers host-detected banner show/hide, "Switch to caption mode" flip,
 * "Try anyway" dismiss path, and that caption-mode submit posts both
 * `raw_text` and `stashed_source_url`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

const apiFetchMock = vi.fn();
vi.mock('@/lib/utils/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/utils/api-client')>(
    '@/lib/utils/api-client',
  );
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  };
});

import { ImportPasteForm } from '@/components/import/ImportPasteForm';

beforeEach(() => {
  pushMock.mockReset();
  apiFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function getUrlInput(): HTMLInputElement {
  return screen.getByLabelText(/URL/i) as HTMLInputElement;
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText(/Caption text/i) as HTMLTextAreaElement;
}

describe('ImportPasteForm — caption-mode banner (B-035)', () => {
  it('does not render banner on initial mount', () => {
    render(<ImportPasteForm tripId="trip-1" />);
    expect(screen.queryByTestId('caption-mode-banner')).toBeNull();
  });

  it('does not render banner for a YouTube URL', () => {
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.youtube.com/watch?v=abc' },
    });
    expect(screen.queryByTestId('caption-mode-banner')).toBeNull();
  });

  it.each([
    'https://www.instagram.com/p/DYWoZkMmGgh/',
    'https://instagram.com/p/x/',
    'https://www.tiktok.com/@a/video/1',
    'https://tiktok.com/@a/video/1',
    'https://vm.tiktok.com/abc/',
  ])('renders banner when URL host is %s', (urlValue) => {
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), { target: { value: urlValue } });
    expect(screen.getByTestId('caption-mode-banner')).toBeTruthy();
  });

  it('banner has role="status" (informational, not alert)', () => {
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.instagram.com/p/x/' },
    });
    const banner = screen.getByTestId('caption-mode-banner');
    expect(banner.getAttribute('role')).toBe('status');
  });

  it('"Try anyway" dismisses banner for current paste', () => {
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.instagram.com/p/x/' },
    });
    expect(screen.getByTestId('caption-mode-banner')).toBeTruthy();
    fireEvent.click(screen.getByText(/Try anyway/i));
    expect(screen.queryByTestId('caption-mode-banner')).toBeNull();
  });

  it('"Try anyway" + clearing then re-pasting brings banner back', () => {
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.instagram.com/p/x/' },
    });
    fireEvent.click(screen.getByText(/Try anyway/i));
    expect(screen.queryByTestId('caption-mode-banner')).toBeNull();
    // Clear field, then paste another Instagram URL.
    fireEvent.change(getUrlInput(), { target: { value: '' } });
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.instagram.com/p/y/' },
    });
    expect(screen.getByTestId('caption-mode-banner')).toBeTruthy();
  });

  it('"Switch to caption mode" hides URL field, shows stashed chip, focuses textarea', () => {
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.instagram.com/p/DYWoZkMmGgh/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Switch to caption mode/i }));
    // URL field gone, stashed chip + textarea remain.
    expect(screen.queryByLabelText(/^URL$/i)).toBeNull();
    const chip = screen.getByTestId('stashed-url-chip');
    expect(chip.textContent).toContain('https://www.instagram.com/p/DYWoZkMmGgh/');
    // Banner is gone too.
    expect(screen.queryByTestId('caption-mode-banner')).toBeNull();
  });

  it('caption-mode submit posts raw_text + stashed_source_url and pushes to review', async () => {
    apiFetchMock.mockResolvedValueOnce({
      import_source_id: 'src-123',
      source_type: 'text',
      captions_unavailable: false,
      extracted: { places: [], tips: [] },
    });
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.instagram.com/p/DYWoZkMmGgh/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Switch to caption mode/i }));
    fireEvent.change(getTextarea(), {
      target: { value: 'Loved the sushi at Sushi Saito and the ramen at Ichiran.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Extract places/i }));
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [path, opts] = apiFetchMock.mock.calls[0] as [
      string,
      { method: string; body: Record<string, unknown> },
    ];
    expect(path).toBe('/api/trips/trip-1/import/extract');
    expect(opts.method).toBe('POST');
    expect(opts.body).toEqual({
      raw_text: 'Loved the sushi at Sushi Saito and the ramen at Ichiran.',
      stashed_source_url: 'https://www.instagram.com/p/DYWoZkMmGgh/',
    });
    expect(pushMock).toHaveBeenCalledWith('/trips/trip-1/import?source=src-123');
  });

  it('URL-only submit still works (no regression)', async () => {
    apiFetchMock.mockResolvedValueOnce({
      import_source_id: 'src-yt',
      source_type: 'youtube',
      captions_unavailable: false,
      extracted: { places: [], tips: [] },
    });
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.youtube.com/watch?v=abc' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Extract places/i }));
    });
    const [, opts] = apiFetchMock.mock.calls[0] as [
      string,
      { method: string; body: Record<string, unknown> },
    ];
    expect(opts.body).toEqual({ source_url: 'https://www.youtube.com/watch?v=abc' });
  });

  it('"Use a different URL" exits caption-mode and restores URL field', () => {
    render(<ImportPasteForm tripId="trip-1" />);
    fireEvent.change(getUrlInput(), {
      target: { value: 'https://www.instagram.com/p/x/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Switch to caption mode/i }));
    expect(screen.getByTestId('stashed-url-chip')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use a different URL/i }));
    expect(screen.queryByTestId('stashed-url-chip')).toBeNull();
    expect(screen.getByLabelText(/^URL$/i)).toBeTruthy();
  });
});
