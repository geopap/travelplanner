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

export function daysBetween(startIso: string, endIso: string): number {
  const start = parseDateOnly(startIso);
  const end = parseDateOnly(endIso);
  if (!start || !end) return 0;
  return (
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );
}
