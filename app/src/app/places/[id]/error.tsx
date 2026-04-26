// Client error boundary for `/places/[id]`. Triggered by uncaught render
// errors or thrown errors during the server component's data load. Provides
// a reset button to retry the segment.

"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PlaceDetailError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to console only — no PII; useful in dev. Production logging is
    // handled server-side by the API route.
    console.error("place_detail_error", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main
      role="alert"
      className="mx-auto w-full max-w-md px-4 py-12 text-center sm:px-6"
    >
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Something went wrong
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        We couldn&apos;t load this place. Please try again in a moment.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        Try again
      </button>
    </main>
  );
}
