"use client";

import { useEffect, useRef, useState } from "react";

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description: string;
  requireTypedName?: string; // when provided, user must type this exact value
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  requireTypedName,
  confirmLabel = "Delete",
  busy = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  const [typed, setTyped] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Derive: when `open` transitions, reset typed value. React 19-safe
  // "update state from props" pattern.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (typed !== "") setTyped("");
  }

  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const namesMatch =
    requireTypedName === undefined || typed === requireTypedName;
  const disabled = busy || !namesMatch;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6">
        <h2
          id="confirm-delete-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {description}
        </p>

        {requireTypedName !== undefined && (
          <div className="mt-4">
            <label
              htmlFor="confirm-typed"
              className="block text-sm font-medium mb-1.5 text-zinc-800 dark:text-zinc-200"
            >
              Type <span className="font-mono">{requireTypedName}</span> to
              confirm
            </label>
            <input
              id="confirm-typed"
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full h-10 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 px-4 rounded-full border border-zinc-300 dark:border-zinc-700 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={disabled}
            className="h-10 px-4 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
