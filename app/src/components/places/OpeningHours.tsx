// Opening hours block for a place. Renders Google's pre-localized
// `weekday_text` lines when available (Monday → Sunday in en locale), with
// the row matching the viewer's current weekday visually emphasized.
//
// `open_now` is OPTIONAL and reflected by a small green pill when true.
// When the API omits hours entirely we render a friendly empty state.

"use client";

import { useSyncExternalStore } from "react";
import type { WeeklyHours } from "@/lib/types/domain";

interface OpeningHoursProps {
  hours: WeeklyHours | null;
}

// Google `weekday_text` for `en` is ordered Monday-first (index 0 = Monday).
// JS `Date.getDay()` is 0 = Sunday … 6 = Saturday. Map JS day → Google index.
const JS_TO_GOOGLE_INDEX: Record<number, number> = {
  0: 6, // Sun
  1: 0, // Mon
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5, // Sat
};

// Static subscribe — current weekday is computed once per mount; we don't
// react to weekday boundary changes during a session.
function subscribeNoop(): () => void {
  return () => undefined;
}
function getClientTodayIndex(): number | null {
  const jsDay = new Date().getDay();
  return JS_TO_GOOGLE_INDEX[jsDay] ?? null;
}
function getServerTodayIndex(): number | null {
  return null;
}

export function OpeningHours({ hours }: OpeningHoursProps) {
  // useSyncExternalStore returns the client value post-hydration without
  // an SSR mismatch and without a setState-in-effect lint violation.
  const todayIndex = useSyncExternalStore(
    subscribeNoop,
    getClientTodayIndex,
    getServerTodayIndex,
  );

  if (!hours || hours.weekday_text.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Hours not published.
      </p>
    );
  }

  return (
    <div>
      {hours.open_now === true ? (
        <span
          aria-label="Open now"
          className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        >
          Open now
        </span>
      ) : hours.open_now === false ? (
        <span
          aria-label="Closed now"
          className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
        >
          Closed now
        </span>
      ) : null}
      <ul className="mt-3 space-y-1 text-sm">
        {hours.weekday_text.map((line, idx) => {
          const isToday = todayIndex === idx;
          return (
            <li
              key={idx}
              aria-current={isToday ? "date" : undefined}
              className={
                isToday
                  ? "font-semibold text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-700 dark:text-zinc-300"
              }
            >
              {line}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
