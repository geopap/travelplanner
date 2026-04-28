"use client";

// B-014 AC-9 — Confirmation dialog for deleting an expense.
// Mirrors RemoveAccommodationDialog: focus management, Tab trap, Escape.
// Surfaces the description + amount so the user can verify before delete.

import { useEffect, useRef } from "react";
import { formatCurrency, formatDate } from "@/lib/utils/format";

interface RemoveExpenseDialogProps {
  open: boolean;
  description: string;
  amount: number;
  currency: string;
  occurredAt: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RemoveExpenseDialog({
  open,
  description,
  amount,
  currency,
  occurredAt,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: RemoveExpenseDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function getFocusable(): HTMLElement[] {
      const root = dialogRef.current;
      if (!root) return [];
      const selector =
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(root.querySelectorAll<HTMLElement>(selector));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!busy) onCancel();
        return;
      }
      if (e.key === "Tab") {
        const focusables = getFocusable();
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !dialogRef.current?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !dialogRef.current?.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, busy]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-expense-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6"
      >
        <h2
          id="remove-expense-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Delete this expense?
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-100">
            {description}
          </span>
          <span className="block mt-0.5 text-xs text-zinc-500">
            {formatCurrency(amount, currency)} · {formatDate(occurredAt)}
          </span>
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          This will remove the expense from totals and balances. It cannot be
          undone.
        </p>

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
            disabled={busy}
            className="h-10 px-4 rounded-full bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Deleting…" : "Delete expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
