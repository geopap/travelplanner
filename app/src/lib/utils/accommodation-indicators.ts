// B-023 — Pure formatters for accommodation marker popups on the day-view map.
//
// Also exports `computeIndicatorType` used by the day-map API route to derive
// the four-state enum from raw check-in/check-out dates vs. the rendered day.
// Kept here (not in a route) so the helper is unit-testable in isolation.

import type { AccommodationIndicatorType as IndicatorEnum } from '@/lib/types/accommodations';

/**
 * Pure: compute the indicator type for a day-scoped accommodation marker.
 * - `same_day`: single-night stay where check-in === check-out === day_date
 * - `check_in`: day_date === check_in_date (multi-night, arrival day)
 * - `check_out`: day_date === check_out_date (multi-night, departure day)
 * - `in_stay`: day_date strictly between check-in and check-out
 *
 * Caller is responsible for ensuring the input falls within the stay range
 * (`check_in_date <= day_date <= check_out_date`); a day_date outside the
 * range collapses to `in_stay` (defensive — the SELECT already filters this).
 */
export function computeIndicatorType(input: {
  check_in_date: string;
  check_out_date: string;
  day_date: string;
}): IndicatorEnum {
  if (
    input.check_in_date === input.check_out_date &&
    input.check_in_date === input.day_date
  ) {
    return 'same_day';
  }
  if (input.day_date === input.check_in_date) return 'check_in';
  if (input.day_date === input.check_out_date) return 'check_out';
  return 'in_stay';
}

//
// Kept in lib/utils/ so they are trivially testable without rendering Leaflet
// (which touches `window` at module load and breaks vitest's node environment).
// Mirrors the conventions used by B-015's item-popup time formatter.

import type { AccommodationIndicatorType } from '@/lib/types/accommodations';

/**
 * Format an ISO YYYY-MM-DD date for display in a marker popup. Uses
 * `Intl.DateTimeFormat` (no i18n in v1) and falls back to the raw string if
 * the input does not parse. Returns the formatted localized date (e.g.
 * "May 17, 2026" in en-US).
 */
export function formatAccommodationDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  // UTC midnight — date-only column, no tz drift.
  const d = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

interface AccommodationLabelInput {
  indicator_type: AccommodationIndicatorType;
  check_in_date: string;
  check_out_date: string;
  /** The day this marker is being rendered for. Used by `same_day` / `in_stay`. */
  day_date: string;
}

/**
 * Build the contextual second-line label for an accommodation marker popup.
 *
 * Per B-023 AC 10, all four `indicator_type` values share one bed icon; the
 * popup carries the type-specific text. `in_stay` deliberately omits a date
 * (the user is rendering on day X and the marker means "staying at"); the
 * other three cite the relevant check-in/out date.
 */
export function formatAccommodationPopupLabel(
  input: AccommodationLabelInput,
): string {
  switch (input.indicator_type) {
    case 'check_in':
      return `Check-in: ${formatAccommodationDate(input.check_in_date)}`;
    case 'check_out':
      return `Check-out: ${formatAccommodationDate(input.check_out_date)}`;
    case 'same_day':
      // Same-day stays use the check-in date (== check-out date by DB invariant).
      return `Check-in & Check-out: ${formatAccommodationDate(
        input.check_in_date,
      )}`;
    case 'in_stay':
      return 'Staying at';
  }
}
