// Formatting utilities. All date/currency formatting goes through Intl.

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(iso: string): string {
  // iso expected as YYYY-MM-DD or full ISO datetime
  const d = parseDateOnly(iso);
  if (!d) return iso;
  return DATE_FORMATTER.format(d);
}

export function formatShortDate(iso: string): string {
  const d = parseDateOnly(iso);
  if (!d) return iso;
  return SHORT_DATE_FORMATTER.format(d);
}

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return TIME_FORMATTER.format(d);
}

export function formatCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return "";
  const iso = currency && /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: iso,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${iso}`;
  }
}

function parseDateOnly(iso: string): Date | null {
  // Treat YYYY-MM-DD as a UTC date to avoid TZ shifting the displayed day.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match) {
    const d = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATETIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * Format an ISO-with-offset datetime as a single human string in the
 * browser's locale (e.g. "13 Nov 2026, 09:45"). Empty string when null/invalid.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return DATETIME_FORMATTER.format(d);
}

/**
 * Convert a `<input type="datetime-local">` value (naive local wallclock,
 * `YYYY-MM-DDTHH:MM`) to an ISO-8601 string with the browser's UTC offset.
 *
 * `new Date(localValue)` interprets the string as local time; `.toISOString()`
 * then yields the correct UTC moment. This keeps the form contract that the
 * user typed wallclock in their own timezone and the server stores UTC.
 *
 * Returns null for empty input or unparseable values.
 */
export function localInputToIsoWithOffset(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Convert a stored ISO-with-offset datetime to the value expected by
 * `<input type="datetime-local">` (`YYYY-MM-DDTHH:MM`) using the user's
 * local wallclock. Empty string when null/invalid.
 */
export function isoToLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Number of nights between an inclusive YYYY-MM-DD pair (check-in →
 * check-out). Same-day = 0. Extracted from AccommodationsList (R4 MED).
 */
export function computeNights(checkIn: string, checkOut: string): number {
  if (checkIn === checkOut) return 0;
  // daysBetween is inclusive (start..end); nights = days - 1.
  const days = daysBetween(checkIn, checkOut);
  return Math.max(0, days - 1);
}

/**
 * Formats a check-in/check-out pair: collapses same-day to a single date,
 * otherwise renders "<in> → <out>". Extracted from AccommodationsList (R4 MED).
 */
export function formatDateRange(checkIn: string, checkOut: string): string {
  if (checkIn === checkOut) return formatDate(checkIn);
  return `${formatDate(checkIn)} → ${formatDate(checkOut)}`;
}

/**
 * Picks the best cost label for an accommodation:
 *   - total_cost wins
 *   - else cost_per_night × nights (with breakdown)
 *   - else null
 * Extracted from AccommodationsList (R4 MED).
 */
export function pickAccommodationCost(
  acc: {
    total_cost: number | null;
    cost_per_night: number | null;
    currency: string | null;
  },
  nights: number,
): string | null {
  if (acc.total_cost !== null) {
    return formatCurrency(acc.total_cost, acc.currency);
  }
  if (acc.cost_per_night !== null) {
    if (nights > 0) {
      const total = acc.cost_per_night * nights;
      const totalLabel = formatCurrency(total, acc.currency);
      const perNight = formatCurrency(acc.cost_per_night, acc.currency);
      return `${totalLabel} (${perNight}/night × ${nights})`;
    }
    return `${formatCurrency(acc.cost_per_night, acc.currency)} / night`;
  }
  return null;
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = parseDateOnly(startIso);
  const end = parseDateOnly(endIso);
  if (!start || !end) return 0;
  return (
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );
}
