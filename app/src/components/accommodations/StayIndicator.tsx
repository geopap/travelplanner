"use client";

// B-008 AC-4 — small badge component rendered on a day card to show which
// accommodation(s) overlap that day. One indicator type per (day, stay):
//   - check_in   → first day of a multi-day stay
//   - in_stay    → intermediate day
//   - check_out  → last day of a multi-day stay
//   - same_day   → check_in_date === check_out_date (day-use)

import type { AccommodationIndicatorType } from "@/lib/types/accommodations";

interface StayIndicatorProps {
  type: AccommodationIndicatorType;
  /** Hotel display label — `hotel_name` or fallback `place.name`. */
  name: string;
}

interface Variant {
  label: (name: string) => string;
  /** Tailwind classes for the pill background/border/text. */
  tone: string;
  /** Inline SVG icon. */
  icon: React.ReactNode;
}

const ICON_BED = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="w-3.5 h-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 18V8m0 0h13a4 4 0 014 4v6m-17 0h17m-17 0v3m17-3v3M3 14h17m-12-2a2 2 0 100-4 2 2 0 000 4z"
    />
  </svg>
);

const ICON_ARROW_IN = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="w-3.5 h-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 12h13l-3-3m3 3l-3 3M21 5v14"
    />
  </svg>
);

const ICON_ARROW_OUT = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="w-3.5 h-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 12H8m3-3l-3 3m3 3l-3-3M3 5v14"
    />
  </svg>
);

const ICON_SUN = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    className="w-3.5 h-3.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 4v2m0 12v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M4 12H2m20 0h-2M6.34 17.66l-1.41 1.41m13.43-13.43l-1.41 1.41M16 12a4 4 0 11-8 0 4 4 0 018 0z"
    />
  </svg>
);

const VARIANTS: Record<AccommodationIndicatorType, Variant> = {
  check_in: {
    label: (name) => `Check in: ${name}`,
    tone: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900",
    icon: ICON_ARROW_IN,
  },
  in_stay: {
    label: (name) => `Staying at: ${name}`,
    tone: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900",
    icon: ICON_BED,
  },
  check_out: {
    label: (name) => `Check out: ${name}`,
    tone: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900",
    icon: ICON_ARROW_OUT,
  },
  same_day: {
    label: (name) => `Day-use: ${name}`,
    tone: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-950/50 dark:text-fuchsia-300 dark:border-fuchsia-900",
    icon: ICON_SUN,
  },
};

export function StayIndicator({ type, name }: StayIndicatorProps) {
  const variant = VARIANTS[type];
  const display = name && name.trim().length > 0 ? name : "Accommodation";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${variant.tone}`}
    >
      {variant.icon}
      <span className="truncate max-w-[24ch]">{variant.label(display)}</span>
    </span>
  );
}
