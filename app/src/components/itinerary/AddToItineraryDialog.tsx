"use client";

// B-033 — "Add to Itinerary" dialog. Surfaced from:
//   - Bookmark rows on /trips/[id]/places (BookmarkItem)
//   - Place detail header /places/[id]?trip=<uuid> (PlaceDetailView pill row)
//
// Submits to canonical POST /api/trips/[id]/items with `source_card_id`
// implicitly null (the route never reads it — user-scheduled rows are not
// Trello-paired). Multi-day re-adds are intentionally allowed (no client
// duplicate guard, no server guard for this flow).
//
// Type selector excludes `transport` per AC: transport needs a structured
// transportation payload that this dialog deliberately does not collect.
// Defaults from bookmark/place category: restaurant → meal; everything else
// (sight/museum/shopping/other) → activity.

import { useEffect, useRef, useState } from "react";
import {
  FormField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
  textareaClass,
} from "@/components/ui/FormField";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import type { TripDay } from "@/lib/types/domain";

/** Bookmark/place categories the dialog understands for type-default mapping. */
export type AddToItineraryCategory =
  | "restaurant"
  | "sight"
  | "museum"
  | "shopping"
  | "other";

/**
 * Subset of ItineraryItemType excluding `transport` (AC — transport needs its
 * own structured payload + dedicated entry point).
 */
export type AddToItineraryType = "meal" | "activity" | "lodging" | "note";

interface AddToItineraryDialogProps {
  open: boolean;
  onClose: () => void;
  tripId: string;
  /** Internal places.id UUID — passed through as `place_id` on the POST. */
  placeId: string;
  /**
   * Display name shown in the dialog header so the user can confirm which
   * place they're scheduling. NOT sent to the API — the server resolves the
   * title from `places.name` when omitted (B-033 backend behaviour).
   */
  placeName: string;
  /** Bookmark/place category used to seed the type selector default. */
  category: AddToItineraryCategory;
  /** Dated days for the trip; required to render the day selector. */
  days: TripDay[];
  /** Called after a successful POST so the parent can refresh + toast. */
  onAdded?: (summary: { dayLabel: string }) => void;
  /** Trigger element to return focus to when the dialog closes. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

type Status = "idle" | "submitting" | "error";

function defaultTypeFor(category: AddToItineraryCategory): AddToItineraryType {
  return category === "restaurant" ? "meal" : "activity";
}

const TYPE_OPTIONS: ReadonlyArray<{ value: AddToItineraryType; label: string }> = [
  { value: "meal", label: "Meal" },
  { value: "activity", label: "Activity" },
  { value: "lodging", label: "Lodging" },
  { value: "note", label: "Note" },
];

const DAY_DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDayLabel(day: TripDay): string {
  const [y, m, d] = day.date.split("-").map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return `Day ${day.day_number}`;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  const label = DAY_DATE_FMT.format(dt);
  return `Day ${day.day_number} · ${label}`;
}

/**
 * Combine the day's calendar date (YYYY-MM-DD) with an HH:MM time picker
 * value into an ISO-8601 timestamp with a UTC offset. We anchor on UTC so
 * the value round-trips deterministically regardless of viewer timezone —
 * matches the rest of the itinerary stack (B-007).
 */
function buildIsoFromDayAndTime(
  dayDate: string,
  hhmm: string,
): string | null {
  if (!hhmm) return null;
  const [y, mo, d] = dayDate.split("-").map((p) => Number.parseInt(p, 10));
  const [h, m] = hhmm.split(":").map((p) => Number.parseInt(p, 10));
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(mo) ||
    !Number.isFinite(d) ||
    !Number.isFinite(h) ||
    !Number.isFinite(m)
  ) {
    return null;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d, h, m, 0));
  return dt.toISOString();
}

interface CreateItemResponse {
  item: { id: string; day_id: string | null };
}

export function AddToItineraryDialog({
  open,
  onClose,
  tripId,
  placeId,
  placeName,
  category,
  days,
  onAdded,
  returnFocusRef,
}: AddToItineraryDialogProps) {
  const [dayId, setDayId] = useState<string>("");
  const [type, setType] = useState<AddToItineraryType>(defaultTypeFor(category));
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Track open transition so reset happens during render (no effect race).
  const [openSeen, setOpenSeen] = useState(false);

  if (open && !openSeen) {
    setOpenSeen(true);
    setDayId("");
    setType(defaultTypeFor(category));
    setStartTime("");
    setEndTime("");
    setNotes("");
    setStatus("idle");
    setErrorMessage(null);
    setTimeError(null);
  }
  if (!open && openSeen) {
    setOpenSeen(false);
  }

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const target = returnFocusRef?.current;
      if (target && typeof target.focus === "function") {
        target.focus();
      }
    };
  }, [open, onClose, returnFocusRef]);

  // Lightweight focus trap mirroring RelinkPlaceDialog.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  const selectedDay = days.find((d) => d.id === dayId) ?? null;
  const canSubmit =
    selectedDay !== null && status !== "submitting" && timeError === null;

  function validateTimes(s: string, e: string): string | null {
    if (!s || !e) return null;
    if (e < s) return "End time must be on or after start time";
    return null;
  }

  function onStartTimeChange(value: string) {
    setStartTime(value);
    setTimeError(validateTimes(value, endTime));
  }
  function onEndTimeChange(value: string) {
    setEndTime(value);
    setTimeError(validateTimes(startTime, value));
  }

  async function onConfirm() {
    if (!selectedDay) return;
    const tErr = validateTimes(startTime, endTime);
    if (tErr) {
      setTimeError(tErr);
      return;
    }
    setStatus("submitting");
    setErrorMessage(null);
    try {
      // Build body. `title` intentionally omitted — server resolves from
      // places.name (B-033). `source_card_id` not sent — the route never
      // reads it on this flow (user-scheduled, not Trello-paired).
      const body: Record<string, unknown> = {
        day_id: selectedDay.id,
        type,
        place_id: placeId,
      };
      const startIso = buildIsoFromDayAndTime(selectedDay.date, startTime);
      const endIso = buildIsoFromDayAndTime(selectedDay.date, endTime);
      if (startIso) body.start_time = startIso;
      if (endIso) body.end_time = endIso;
      const trimmedNotes = notes.trim();
      if (trimmedNotes) body.notes = trimmedNotes;

      await apiFetch<CreateItemResponse>(
        `/api/trips/${encodeURIComponent(tripId)}/items`,
        { method: "POST", body },
      );
      const dayLabel = formatDayLabel(selectedDay);
      onAdded?.({ dayLabel });
      onClose();
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiClientError) {
        if (err.status === 403) {
          setErrorMessage("You don't have permission to add items to this trip.");
        } else if (err.status === 404) {
          setErrorMessage("This trip is no longer available.");
        } else if (err.status === 400) {
          setErrorMessage(err.message);
        } else if (err.status === 429) {
          setErrorMessage("Too many requests. Please try again shortly.");
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage("Failed to add to itinerary. Please try again.");
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-itinerary-title"
      // z-[1100] to sit above the Leaflet map (z-400) and existing modals
      // (z-50); matches the convention used by RelinkPlaceDialog peers.
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4 bg-black/50"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-200 dark:border-zinc-800 p-6"
      >
        <h2
          id="add-to-itinerary-title"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
        >
          Add to itinerary
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Scheduling{" "}
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {placeName}
          </span>
          .
        </p>

        <div className="mt-4 space-y-4">
          <FormField id="add-itin-day" label="Day" required>
            <select
              id="add-itin-day"
              className={selectClass}
              value={dayId}
              onChange={(e) => setDayId(e.target.value)}
              required
              aria-required="true"
            >
              <option value="">Select a day…</option>
              {days.map((d) => (
                <option key={d.id} value={d.id}>
                  {formatDayLabel(d)}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="add-itin-type" label="Type">
            <select
              id="add-itin-type"
              className={selectClass}
              value={type}
              onChange={(e) =>
                setType(e.target.value as AddToItineraryType)
              }
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField id="add-itin-start" label="Start time">
              <input
                id="add-itin-start"
                type="time"
                className={inputClass}
                value={startTime}
                onChange={(e) => onStartTimeChange(e.target.value)}
              />
            </FormField>
            <FormField
              id="add-itin-end"
              label="End time"
              error={timeError ?? undefined}
            >
              <input
                id="add-itin-end"
                type="time"
                className={inputClass}
                value={endTime}
                onChange={(e) => onEndTimeChange(e.target.value)}
                aria-invalid={timeError !== null}
              />
            </FormField>
          </div>

          <FormField id="add-itin-notes" label="Notes">
            <textarea
              id="add-itin-notes"
              className={textareaClass}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={5000}
              placeholder="Optional"
            />
          </FormField>
        </div>

        {status === "error" && errorMessage && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
          >
            {errorMessage}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className={secondaryButtonClass}
            disabled={status === "submitting"}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={primaryButtonClass}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
          >
            {status === "submitting" ? "Adding…" : "Add to itinerary"}
          </button>
        </div>
      </div>
    </div>
  );
}
