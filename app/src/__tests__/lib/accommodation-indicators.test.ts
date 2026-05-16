/**
 * B-023 — Unit tests for accommodation popup formatters.
 * Pure functions; no DOM, no Leaflet.
 */
import { describe, it, expect } from 'vitest';
import {
  formatAccommodationDate,
  formatAccommodationPopupLabel,
  computeIndicatorType,
} from '@/lib/utils/accommodation-indicators';

describe('formatAccommodationDate (B-023)', () => {
  it('formats a valid ISO date with month/day/year', () => {
    const out = formatAccommodationDate('2026-05-17');
    // Locale-dependent; just assert it contains the year and isn't the raw ISO.
    expect(out).toContain('2026');
    expect(out).not.toBe('2026-05-17');
  });

  it('returns the input verbatim for a non-ISO string', () => {
    expect(formatAccommodationDate('not-a-date')).toBe('not-a-date');
  });

  it('returns the input verbatim for an out-of-shape string', () => {
    expect(formatAccommodationDate('2026/05/17')).toBe('2026/05/17');
  });
});

describe('formatAccommodationPopupLabel (B-023, AC 10)', () => {
  const dates = {
    check_in_date: '2026-05-17',
    check_out_date: '2026-05-19',
    day_date: '2026-05-18',
  };

  it('check_in shows the check-in date', () => {
    const label = formatAccommodationPopupLabel({
      ...dates,
      indicator_type: 'check_in',
    });
    expect(label).toMatch(/^Check-in: /);
    expect(label).toContain('2026');
  });

  it('check_out shows the check-out date', () => {
    const label = formatAccommodationPopupLabel({
      ...dates,
      indicator_type: 'check_out',
    });
    expect(label).toMatch(/^Check-out: /);
  });

  it('same_day shows the combined label with the check-in date', () => {
    const label = formatAccommodationPopupLabel({
      check_in_date: '2026-05-17',
      check_out_date: '2026-05-17',
      day_date: '2026-05-17',
      indicator_type: 'same_day',
    });
    expect(label).toMatch(/^Check-in & Check-out: /);
  });

  it('in_stay shows "Staying at" with no date', () => {
    const label = formatAccommodationPopupLabel({
      ...dates,
      indicator_type: 'in_stay',
    });
    expect(label).toBe('Staying at');
  });
});

describe('computeIndicatorType (B-023)', () => {
  it('maps single-night same-day stay to "same_day"', () => {
    expect(
      computeIndicatorType({
        check_in_date: '2026-05-17',
        check_out_date: '2026-05-17',
        day_date: '2026-05-17',
      }),
    ).toBe('same_day');
  });

  it('maps arrival day to "check_in"', () => {
    expect(
      computeIndicatorType({
        check_in_date: '2026-05-17',
        check_out_date: '2026-05-19',
        day_date: '2026-05-17',
      }),
    ).toBe('check_in');
  });

  it('maps departure day to "check_out"', () => {
    expect(
      computeIndicatorType({
        check_in_date: '2026-05-17',
        check_out_date: '2026-05-19',
        day_date: '2026-05-19',
      }),
    ).toBe('check_out');
  });

  it('maps mid-stay day to "in_stay"', () => {
    expect(
      computeIndicatorType({
        check_in_date: '2026-05-17',
        check_out_date: '2026-05-19',
        day_date: '2026-05-18',
      }),
    ).toBe('in_stay');
  });
});

// B-023 R5 — property-style tests tying computeIndicatorType to
// formatAccommodationPopupLabel. Confirms the two helpers compose correctly
// for every indicator_type the day-map endpoint can emit.
describe('computeIndicatorType + formatAccommodationPopupLabel composition (B-023)', () => {
  type Case = {
    label: string;
    check_in_date: string;
    check_out_date: string;
    day_date: string;
    expectedType: 'same_day' | 'check_in' | 'check_out' | 'in_stay';
    labelPrefix: RegExp;
  };

  const cases: readonly Case[] = [
    {
      label: 'same_day',
      check_in_date: '2026-05-17',
      check_out_date: '2026-05-17',
      day_date: '2026-05-17',
      expectedType: 'same_day',
      labelPrefix: /^Check-in & Check-out: /,
    },
    {
      label: 'check_in',
      check_in_date: '2026-05-17',
      check_out_date: '2026-05-19',
      day_date: '2026-05-17',
      expectedType: 'check_in',
      labelPrefix: /^Check-in: /,
    },
    {
      label: 'check_out',
      check_in_date: '2026-05-17',
      check_out_date: '2026-05-19',
      day_date: '2026-05-19',
      expectedType: 'check_out',
      labelPrefix: /^Check-out: /,
    },
    {
      label: 'in_stay',
      check_in_date: '2026-05-17',
      check_out_date: '2026-05-19',
      day_date: '2026-05-18',
      expectedType: 'in_stay',
      labelPrefix: /^Staying at$/,
    },
  ];

  for (const c of cases) {
    it(`composes correctly for ${c.label}`, () => {
      const indicator_type = computeIndicatorType({
        check_in_date: c.check_in_date,
        check_out_date: c.check_out_date,
        day_date: c.day_date,
      });
      expect(indicator_type).toBe(c.expectedType);
      const popup = formatAccommodationPopupLabel({
        check_in_date: c.check_in_date,
        check_out_date: c.check_out_date,
        day_date: c.day_date,
        indicator_type,
      });
      expect(popup).toMatch(c.labelPrefix);
      // in_stay must not embed any date string
      if (indicator_type === 'in_stay') {
        expect(popup).not.toContain('2026');
      } else {
        expect(popup).toContain('2026');
      }
    });
  }
});
