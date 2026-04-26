// Tiny client component: copies a place address to the clipboard with a
// transient "Copied" confirmation. Falls back gracefully when the clipboard
// API is unavailable (older browsers, insecure context).

"use client";

import { useState } from "react";

interface CopyAddressButtonProps {
  value: string;
}

export function CopyAddressButton({ value }: CopyAddressButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Silently swallow — user can still select the address text manually.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy address"
      className="inline-flex items-center rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
