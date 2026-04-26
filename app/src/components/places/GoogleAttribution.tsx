// Google Places attribution footer — required by Google Places ToS for any UI
// that surfaces Places data outside of a Google Map. Displays the "Powered by
// Google" wordmark text plus per-photo author attributions when present.
//
// Attributions are rendered as plain JSX from validated structured data
// ({ name, uri }). No HTML strings, no dangerouslySetInnerHTML — uri is
// guaranteed http(s) at the source (lib/google/places.ts:parsePhoto).

import type { PhotoAttribution } from "@/lib/types/domain";

interface GoogleAttributionProps {
  /** Structured author attributions from Google. */
  attributions?: ReadonlyArray<PhotoAttribution>;
}

export function GoogleAttribution({ attributions }: GoogleAttributionProps) {
  const items = attributions ?? [];
  return (
    <footer
      aria-label="Data attribution"
      className="mt-8 border-t border-zinc-200 dark:border-zinc-800 pt-4 text-xs text-zinc-500 dark:text-zinc-400"
    >
      <p className="font-medium">Powered by Google</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {items.map((att, idx) => (
            <li key={`${att.name}:${att.uri ?? ""}:${idx}`}>
              {att.uri ? (
                <a
                  href={att.uri}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="underline hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {att.name}
                </a>
              ) : (
                <span>{att.name}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </footer>
  );
}
