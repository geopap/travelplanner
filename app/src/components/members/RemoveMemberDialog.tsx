"use client";

// B-013 — Confirmation dialog for removing a member from a trip.
// Mirrors the patterns of ConfirmDeleteDialog (focus management, ESC/Tab
// trap, role=dialog, aria-modal). Tailored copy includes the member's
// display name and current role so the owner cannot misclick.

import { useEffect, useRef } from "react";
import type { MemberRole } from "@/lib/types/domain";

interface RemoveMemberDialogProps {
  open: boolean;
  memberLabel: string;
  memberRole: MemberRole;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export function RemoveMemberDialog({
  open,
  memberLabel,
  memberRole,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: RemoveMemberDialogProps) {
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
        onCancel();
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
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-member-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6"
      >
        <h2
          id="remove-member-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Remove member?
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-100">
            {memberLabel}
          </span>{" "}
          ({ROLE_LABEL[memberRole]}) will lose access to this trip immediately
          and any sessions they have open will be redirected. They can be
          re-invited later.
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
            {busy ? "Removing…" : "Remove member"}
          </button>
        </div>
      </div>
    </div>
  );
}
