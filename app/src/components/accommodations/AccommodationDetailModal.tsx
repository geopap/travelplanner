"use client";

// B-024 — Detail modal opened from the day-view accommodation indicator chips.
// Fetches a single accommodation by id, renders the read-only view, and
// (for editors/owners) exposes Edit + Delete actions that reuse the existing
// AccommodationForm and RemoveAccommodationDialog components.
//
// Accessibility:
//   - role="dialog", aria-modal, aria-labelledby on the hotel-name heading
//   - focus trap (Tab/Shift+Tab cycle inside the dialog)
//   - Escape closes
//   - Focus return is owned by the parent (DayCard) via the triggerRef on the
//     chip; this component simply calls onClose.
//
// Responsive:
//   - Bottom sheet on < 640 px (items-end), centred modal at sm+ (items-center).

import { useEffect, useMemo, useRef, useState } from "react";
import type { AccommodationWithPlace } from "@/lib/types/accommodations";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import {
  computeNights,
  formatDateRange,
  pickAccommodationCost,
} from "@/lib/utils/format";
import { secondaryButtonClass } from "@/components/ui/FormField";
import { AccommodationForm } from "./AccommodationForm";
import { RemoveAccommodationDialog } from "./RemoveAccommodationDialog";
import { deleteAccommodation } from "@/lib/hooks/useAccommodations";
import { nameFor } from "@/lib/utils/accommodations";

interface AccommodationDetailModalProps {
  tripId: string;
  accommodationId: string;
  isOpen: boolean;
  canEdit: boolean;
  /** Trip metadata required by AccommodationForm in edit mode. */
  tripStartDate: string;
  tripEndDate: string;
  tripBaseCurrency: string;
  onClose: () => void;
  /** Fired after a successful PATCH or DELETE so the parent can refetch
   *  day-indicators (and any other accommodation-derived state). */
  onMutated: () => void;
}

interface FetchState {
  status: "loading" | "ready" | "error" | "not_found";
  data?: AccommodationWithPlace;
  error?: string;
}

interface DeleteUiState {
  open: boolean;
  busy: boolean;
  error: string | null;
}

export function AccommodationDetailModal({
  tripId,
  accommodationId,
  isOpen,
  canEdit,
  tripStartDate,
  tripEndDate,
  tripBaseCurrency,
  onClose,
  onMutated,
}: AccommodationDetailModalProps) {
  const [fetchState, setFetchState] = useState<FetchState>({
    status: "loading",
  });
  const [editing, setEditing] = useState(false);
  const [del, setDel] = useState<DeleteUiState>({
    open: false,
    busy: false,
    error: null,
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Fetch accommodation when the modal opens / accommodationId changes.
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    let cancelled = false;
    setFetchState({ status: "loading" });
    (async () => {
      try {
        const data = await apiFetch<{ accommodation: AccommodationWithPlace }>(
          `/api/trips/${encodeURIComponent(
            tripId,
          )}/accommodations/${encodeURIComponent(accommodationId)}`,
          { method: "GET", signal: controller.signal },
        );
        if (cancelled) return;
        setFetchState({ status: "ready", data: data.accommodation });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setFetchState({
            status: "not_found",
            error: "This accommodation no longer exists.",
          });
          return;
        }
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load this accommodation. Please try again.";
        setFetchState({ status: "error", error: message });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, tripId, accommodationId]);

  // When the dialog opens, force read-only mode and focus the close button.
  // Forcing `editing=false` on open avoids the edge case where the modal was
  // previously closed mid-edit and reopens stuck in edit mode.
  useEffect(() => {
    if (!isOpen) return;
    setEditing(false);
    closeButtonRef.current?.focus();
  }, [isOpen]);

  // Escape closes; Tab traps focus inside the dialog. The edit sub-dialog
  // installs its own Escape handler on `window`; this listener stays mounted
  // but only acts when the edit drawer is closed (so Esc inside the form
  // closes the form, not this modal).
  useEffect(() => {
    if (!isOpen) return;
    function getFocusable(): HTMLElement[] {
      const root = dialogRef.current;
      if (!root) return [];
      const selector =
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hasAttribute("aria-hidden"),
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !editing && !del.open && !del.busy) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && !editing && !del.open) {
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
  }, [isOpen, editing, del.open, del.busy, onClose]);

  const titleId = `accommodation-detail-title-${accommodationId}`;

  const computed = useMemo(() => {
    if (fetchState.status !== "ready" || !fetchState.data) return null;
    const acc = fetchState.data;
    const nights = computeNights(acc.check_in_date, acc.check_out_date);
    return {
      acc,
      displayName: nameFor(acc),
      dateRange: formatDateRange(acc.check_in_date, acc.check_out_date),
      nights,
      cost: pickAccommodationCost(acc, nights),
    };
  }, [fetchState]);

  if (!isOpen) return null;

  async function onConfirmDelete() {
    setDel((d) => ({ ...d, busy: true, error: null }));
    try {
      await deleteAccommodation(tripId, accommodationId);
      setDel({ open: false, busy: false, error: null });
      onMutated();
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the accommodation. Please try again.";
      setDel((d) => ({ ...d, busy: false, error: message }));
    }
  }

  // Edit mode swaps the entire modal contents for the existing
  // AccommodationForm (which is itself a full-screen dialog with its own
  // overlay). To avoid double overlays, we render the form *instead of* the
  // detail dialog while editing.
  if (editing && computed) {
    return (
      <AccommodationForm
        mode="edit"
        tripId={tripId}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        tripBaseCurrency={tripBaseCurrency}
        initial={computed.acc}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onMutated();
          onClose();
        }}
      />
    );
  }

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl"
        >
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2
                id={titleId}
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 min-w-0 truncate"
              >
                {fetchState.status === "ready" && computed
                  ? computed.displayName
                  : "Accommodation"}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 -m-2 p-2 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-300"
                aria-label="Close"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 6l12 12M18 6L6 18"
                  />
                </svg>
              </button>
            </div>

            {fetchState.status === "loading" && (
              <div
                role="status"
                aria-live="polite"
                aria-label="Loading accommodation details"
                className="space-y-3"
              >
                <div className="h-3 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                <div className="h-3 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                <div className="h-20 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
              </div>
            )}

            {(fetchState.status === "error" ||
              fetchState.status === "not_found") && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
              >
                {fetchState.error ?? "Could not load this accommodation."}
              </div>
            )}

            {fetchState.status === "ready" && computed && (
              <dl className="space-y-3 text-sm">
                <Row label="Dates">
                  <span className="text-zinc-800 dark:text-zinc-200">
                    {computed.dateRange}
                  </span>
                  {computed.nights > 0 && (
                    <span className="ml-2 text-xs text-zinc-500">
                      {computed.nights}{" "}
                      {computed.nights === 1 ? "night" : "nights"}
                    </span>
                  )}
                </Row>

                {computed.acc.confirmation && (
                  <Row label="Confirmation">
                    <span className="text-zinc-800 dark:text-zinc-200 break-words">
                      {computed.acc.confirmation}
                    </span>
                  </Row>
                )}

                {(computed.acc.cost_per_night !== null ||
                  computed.acc.total_cost !== null) && (
                  <Row label="Cost">
                    <span className="text-zinc-800 dark:text-zinc-200">
                      {computed.cost ?? "—"}
                    </span>
                  </Row>
                )}

                {computed.acc.place && (
                  <Row label="Linked place">
                    <span className="text-zinc-800 dark:text-zinc-200">
                      {computed.acc.place.name}
                    </span>
                    {computed.acc.place.formatted_address && (
                      <span className="block text-xs text-zinc-500 mt-0.5">
                        {computed.acc.place.formatted_address}
                      </span>
                    )}
                  </Row>
                )}

                {computed.acc.notes && (
                  <Row label="Notes">
                    <span className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                      {computed.acc.notes}
                    </span>
                  </Row>
                )}
              </dl>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className={secondaryButtonClass}
              >
                Close
              </button>
              {canEdit && fetchState.status === "ready" && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setDel({ open: true, busy: false, error: null })
                    }
                    className="h-10 px-4 rounded-full border border-red-300 dark:border-red-900 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="h-10 px-4 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-300"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {computed && (
        <RemoveAccommodationDialog
          open={del.open}
          hotelLabel={computed.displayName}
          checkInDate={computed.acc.check_in_date}
          checkOutDate={computed.acc.check_out_date}
          busy={del.busy}
          error={del.error}
          onConfirm={onConfirmDelete}
          onCancel={() => {
            if (del.busy) return;
            setDel({ open: false, busy: false, error: null });
          }}
        />
      )}
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3">
      <dt className="text-xs font-medium uppercase tracking-wider text-zinc-500 pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
