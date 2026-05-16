"use client";

// B-008 — Create/edit form for an accommodation. Drawer-style modal mirroring
// ItineraryItemForm. The user can either:
//   - type a hotel name, or
//   - leave hotel name blank and rely on a linked place (when a place picker
//     is wired up — see note below).
//
// B-023 — Place picker is now wired in. The form accepts a Google place
// selection via <PlaceSearchInput/>; on submit the `google_place_id` is sent
// to the backend, which resolves it to an internal `places.id` server-side.
// On edit, clearing a previously-linked place sends `place_id: null`
// explicitly so the backend detaches the FK. The `accommodations_name_or_place`
// DB constraint is guarded client-side: at least one of (linked place,
// non-empty hotel name) must be present at submit.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PlaceSearchInput } from "@/components/places/PlaceSearchInput";
import type { PlaceSearchResult } from "@/lib/hooks/usePlaceSearch";
import type {
  AccommodationCreateDTO,
  AccommodationPatchDTO,
  AccommodationWithPlace,
} from "@/lib/types/accommodations";
import { ApiClientError } from "@/lib/utils/api-client";
import { COMMON_CURRENCIES } from "@/lib/utils/currencies";
import {
  createAccommodation,
  updateAccommodation,
} from "@/lib/hooks/useAccommodations";
import {
  FormField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  textareaClass,
} from "@/components/ui/FormField";

interface AccommodationFormProps {
  mode: "create" | "edit";
  tripId: string;
  /** Trip date range (YYYY-MM-DD) — used as `min`/`max` and client-side bounds. */
  tripStartDate: string;
  tripEndDate: string;
  tripBaseCurrency: string;
  /** When set, check_in date is pre-filled (e.g. day-card "Add accommodation"). */
  initialCheckInDate?: string;
  initial?: AccommodationWithPlace;
  onClose: () => void;
  onSaved: (accommodation: AccommodationWithPlace) => void;
}

interface FormErrors {
  hotel_name?: string;
  check_in_date?: string;
  check_out_date?: string;
  confirmation?: string;
  cost_per_night?: string;
  total_cost?: string;
  currency?: string;
  notes?: string;
  /** B-023 — name-or-place client guard for the DB constraint. */
  place?: string;
}

const CONFIRMATION_MAX = 80;
const NOTES_MAX = 4000;
const HOTEL_NAME_MAX = 200;

/**
 * When the parent supplies only a check-in date (e.g. the day-card "Add
 * accommodation" CTA), default check-out to the next day clamped to the
 * trip end. Defaults to tripStartDate when no initial date is supplied.
 */
function defaultCheckOut(
  initialCheckInDate: string | undefined,
  tripStartDate: string,
  tripEndDate: string,
): string {
  if (!initialCheckInDate) return tripStartDate;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(initialCheckInDate);
  if (!match) return initialCheckInDate;
  const d = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (Number.isNaN(d.getTime())) return initialCheckInDate;
  d.setUTCDate(d.getUTCDate() + 1);
  const next =
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `-${String(d.getUTCDate()).padStart(2, "0")}`;
  return next > tripEndDate ? tripEndDate : next;
}

export function AccommodationForm({
  mode,
  tripId,
  tripStartDate,
  tripEndDate,
  tripBaseCurrency,
  initialCheckInDate,
  initial,
  onClose,
  onSaved,
}: AccommodationFormProps) {
  const placeName = initial?.place?.name ?? null;

  const [hotelName, setHotelName] = useState<string>(
    initial?.hotel_name ?? "",
  );
  const [checkInDate, setCheckInDate] = useState<string>(
    initial?.check_in_date ?? initialCheckInDate ?? tripStartDate,
  );
  const [checkOutDate, setCheckOutDate] = useState<string>(
    initial?.check_out_date ??
      defaultCheckOut(initialCheckInDate, tripStartDate, tripEndDate),
  );
  const [confirmation, setConfirmation] = useState<string>(
    initial?.confirmation ?? "",
  );
  const [costPerNight, setCostPerNight] = useState<string>(
    initial?.cost_per_night !== null && initial?.cost_per_night !== undefined
      ? String(initial.cost_per_night)
      : "",
  );
  const [totalCost, setTotalCost] = useState<string>(
    initial?.total_cost !== null && initial?.total_cost !== undefined
      ? String(initial.total_cost)
      : "",
  );
  const [currency, setCurrency] = useState<string>(
    initial?.currency ?? tripBaseCurrency,
  );
  const [notes, setNotes] = useState<string>(initial?.notes ?? "");

  // B-023 — place picker state.
  // `linkedPlaceId` mirrors the row's current internal place_id (uuid) for the
  // edit path. When the user picks a NEW place we set `pickedGooglePlaceId`
  // (sent to the backend for resolution) and clear `linkedPlaceId` so the
  // "linked place: …" badge no longer claims the old link is still attached.
  // When the user clears the picker we set both to null and send an explicit
  // `place_id: null` on PATCH to detach.
  const [linkedPlaceId, setLinkedPlaceId] = useState<string | null>(
    initial?.place_id ?? null,
  );
  const [pickedGooglePlaceId, setPickedGooglePlaceId] = useState<string | null>(
    null,
  );
  const [pickedPlaceName, setPickedPlaceName] = useState<string | null>(null);

  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  // True when the form will submit with some place reference (either a
  // pre-existing internal link that wasn't cleared, OR a freshly-picked
  // google_place_id). Drives the "hotel name optional" UX and the DB
  // constraint guard.
  const hasPlaceLink = linkedPlaceId !== null || pickedGooglePlaceId !== null;
  const placeLabel = pickedPlaceName ?? placeName ?? null;

  function handlePlacePicked(place: PlaceSearchResult): void {
    setPickedGooglePlaceId(place.google_place_id);
    setPickedPlaceName(place.name);
    // The new pick supersedes any previously-linked place. Clear the internal
    // FK so the submit logic doesn't carry it forward.
    setLinkedPlaceId(null);
    // Surfacing a successful pick clears any name-or-place validation error.
    setErrors((prev) => {
      const { place: _placeErr, ...rest } = prev;
      return rest;
    });
  }

  function handleClearPlace(): void {
    setPickedGooglePlaceId(null);
    setPickedPlaceName(null);
    setLinkedPlaceId(null);
  }

  function validate(): {
    payload?: AccommodationCreateDTO | AccommodationPatchDTO;
    fieldErrors: FormErrors;
  } {
    const fe: FormErrors = {};
    const trimmedName = hotelName.trim();

    if (!hasPlaceLink && trimmedName.length === 0) {
      // Single error key (`place`) covers the DB constraint
      // `accommodations_name_or_place CHECK (place_id IS NOT NULL OR hotel_name IS NOT NULL)`.
      fe.place = "Provide a hotel name or link a place.";
    } else if (trimmedName.length > HOTEL_NAME_MAX) {
      fe.hotel_name = `Hotel name is too long (max ${HOTEL_NAME_MAX}).`;
    }

    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDate.test(checkInDate)) {
      fe.check_in_date = "Choose a check-in date.";
    } else if (
      checkInDate < tripStartDate ||
      checkInDate > tripEndDate
    ) {
      fe.check_in_date = `Check-in must be within trip dates (${tripStartDate} – ${tripEndDate}).`;
    }

    if (!isoDate.test(checkOutDate)) {
      fe.check_out_date = "Choose a check-out date.";
    } else if (
      checkOutDate < tripStartDate ||
      checkOutDate > tripEndDate
    ) {
      fe.check_out_date = `Check-out must be within trip dates (${tripStartDate} – ${tripEndDate}).`;
    } else if (
      !fe.check_in_date &&
      checkOutDate < checkInDate
    ) {
      fe.check_out_date =
        "Check-out must be on or after check-in (same-day allowed).";
    }

    if (
      confirmation.length > 0 &&
      confirmation.trim().length > CONFIRMATION_MAX
    ) {
      fe.confirmation = `Confirmation is too long (max ${CONFIRMATION_MAX}).`;
    }

    let cpnNum: number | null = null;
    if (costPerNight.trim() !== "") {
      const parsed = Number(costPerNight);
      if (Number.isNaN(parsed) || parsed < 0) {
        fe.cost_per_night = "Cost per night must be a positive number.";
      } else {
        cpnNum = parsed;
      }
    }
    let totalNum: number | null = null;
    if (totalCost.trim() !== "") {
      const parsed = Number(totalCost);
      if (Number.isNaN(parsed) || parsed < 0) {
        fe.total_cost = "Total cost must be a positive number.";
      } else {
        totalNum = parsed;
      }
    }

    const hasCost = cpnNum !== null || totalNum !== null;
    if (hasCost && !/^[A-Z]{3}$/.test(currency)) {
      fe.currency = "Enter a 3-letter ISO 4217 code.";
    }

    if (notes.length > NOTES_MAX) {
      fe.notes = `Notes must be ${NOTES_MAX} characters or fewer.`;
    }

    if (Object.keys(fe).length > 0) {
      return { fieldErrors: fe };
    }

    const payload: AccommodationCreateDTO = {
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
    };
    if (trimmedName) payload.hotel_name = trimmedName;
    // B-023: a freshly-picked place wins over a pre-existing FK; the backend
    // resolves google_place_id → places.id server-side.
    if (pickedGooglePlaceId) {
      payload.google_place_id = pickedGooglePlaceId;
    } else if (linkedPlaceId) {
      payload.place_id = linkedPlaceId;
    }
    const trimmedConf = confirmation.trim();
    if (trimmedConf) payload.confirmation = trimmedConf;
    if (cpnNum !== null) payload.cost_per_night = cpnNum;
    if (totalNum !== null) payload.total_cost = totalNum;
    if (hasCost) payload.currency = currency;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) payload.notes = trimmedNotes;

    return { payload, fieldErrors: fe };
  }

  function buildPatchPayload(): AccommodationPatchDTO | null {
    const { payload, fieldErrors } = validate();
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return null;
    }
    if (!payload) return null;
    // For PATCH, we always send the user's current values for these fields,
    // letting the server diff. Optional null-out for cleared text fields:
    // start from the create-shaped payload but strip its `place_id` (which
    // may carry the row's pre-existing FK — we re-derive below in PATCH terms).
    const { place_id: _ignored, ...rest } = payload as AccommodationCreateDTO;
    const patch: AccommodationPatchDTO = { ...rest };
    // Place-link diff (B-023):
    //   - new google pick           → google_place_id (resolved server-side)
    //   - same internal link        → omit (server treats undefined as no-change)
    //   - cleared a prior link      → explicit place_id: null
    if (pickedGooglePlaceId) {
      patch.google_place_id = pickedGooglePlaceId;
    } else if (linkedPlaceId === null && initial?.place_id != null) {
      patch.place_id = null;
    }
    if (mode === "edit") {
      // Allow clearing fields when edited away from a value.
      if (initial?.confirmation && confirmation.trim() === "") {
        patch.confirmation = undefined;
      }
      if (
        initial?.cost_per_night !== null &&
        initial?.cost_per_night !== undefined &&
        costPerNight.trim() === ""
      ) {
        patch.cost_per_night = undefined;
      }
      if (
        initial?.total_cost !== null &&
        initial?.total_cost !== undefined &&
        totalCost.trim() === ""
      ) {
        patch.total_cost = undefined;
      }
      if (initial?.notes && notes.trim() === "") {
        patch.notes = undefined;
      }
    }
    return patch;
  }

  function mapServerCode(code: string, fallback: string): string {
    switch (code) {
      case "accommodation_dates_outside_trip":
        return `Dates must fall within the trip (${tripStartDate} – ${tripEndDate}).`;
      case "accommodation_dates_invalid":
        return "Check-out must be on or after check-in.";
      case "accommodation_cost_currency_required":
        return "Currency is required when a cost is entered.";
      case "place_not_found":
        return "Linked place no longer exists. Remove the link and try again.";
      case "place_not_cached":
        return "We couldn't find that place in our cache. Re-select it from the picker and try again.";
      default:
        return fallback;
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const { payload, fieldErrors } = validate();
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    if (!payload) return;

    setErrors({});
    setSubmitting(true);
    try {
      if (mode === "create") {
        const created = await createAccommodation(
          tripId,
          payload as AccommodationCreateDTO,
        );
        onSaved(created);
      } else if (initial) {
        const patch = buildPatchPayload();
        if (!patch) {
          setSubmitting(false);
          return;
        }
        const updated = await updateAccommodation(tripId, initial.id, patch);
        onSaved(updated);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        const targeted = mapServerCode(err.code, err.message);
        // Surface field-targeted errors next to the offending fields.
        if (
          err.code === "accommodation_dates_outside_trip" ||
          err.code === "accommodation_dates_invalid"
        ) {
          setErrors((prev) => ({
            ...prev,
            check_out_date: targeted,
          }));
        } else if (err.code === "accommodation_cost_currency_required") {
          setErrors((prev) => ({ ...prev, currency: targeted }));
        } else {
          setFormError(targeted);
        }
      } else {
        setFormError("Could not save the accommodation. Please try again.");
      }
      setSubmitting(false);
    }
  }

  const titleId = "accommodation-form-title";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
    >
      <div
        ref={dialogRef}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl"
      >
        <form onSubmit={onSubmit} noValidate className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            >
              {mode === "create" ? "Add accommodation" : "Edit accommodation"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 -m-2 p-2"
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

          {/* B-023 — place picker. Optional: leave empty to fall back to a
              typed hotel name. Picking a place sends google_place_id on
              submit; the backend resolves it to an internal places.id. */}
          <FormField
            id="acc-place-picker"
            label="Linked place"
            hint="Optional — pick a hotel from Google Places to enable map plotting and cached details."
            error={errors.place}
          >
            {hasPlaceLink && placeLabel ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 p-3 text-sm text-zinc-700 dark:text-zinc-300">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {placeLabel}
                  </span>
                  {pickedGooglePlaceId && (
                    <span className="ml-2 text-xs text-zinc-500">
                      (new selection)
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={handleClearPlace}
                  className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline underline-offset-2"
                >
                  Clear link
                </button>
              </div>
            ) : (
              <PlaceSearchInput
                onSelect={handlePlacePicked}
                placeholder="Search hotels…"
              />
            )}
          </FormField>

          <FormField
            id="acc-hotel-name"
            label="Hotel name"
            required={!hasPlaceLink}
            hint={
              hasPlaceLink
                ? "Optional override of the linked place's name."
                : "Name of the hotel, B&B or apartment."
            }
            error={errors.hotel_name}
          >
            <input
              id="acc-hotel-name"
              ref={firstFieldRef}
              type="text"
              maxLength={HOTEL_NAME_MAX}
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              className={inputClass}
              placeholder={hasPlaceLink ? placeLabel ?? "" : "e.g. Park Hyatt"}
              aria-invalid={errors.hotel_name ? true : undefined}
            />
          </FormField>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField
              id="acc-check-in"
              label="Check-in date"
              required
              error={errors.check_in_date}
            >
              <input
                id="acc-check-in"
                type="date"
                required
                min={tripStartDate}
                max={tripEndDate}
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
                className={inputClass}
                aria-invalid={errors.check_in_date ? true : undefined}
              />
            </FormField>
            <FormField
              id="acc-check-out"
              label="Check-out date"
              required
              hint="Same day allowed for day-use stays."
              error={errors.check_out_date}
            >
              <input
                id="acc-check-out"
                type="date"
                required
                min={tripStartDate}
                max={tripEndDate}
                value={checkOutDate}
                onChange={(e) => setCheckOutDate(e.target.value)}
                className={inputClass}
                aria-invalid={errors.check_out_date ? true : undefined}
              />
            </FormField>
          </div>

          <FormField
            id="acc-confirmation"
            label="Confirmation number"
            error={errors.confirmation}
          >
            <input
              id="acc-confirmation"
              type="text"
              maxLength={CONFIRMATION_MAX}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              className={inputClass}
              placeholder="Optional"
              aria-invalid={errors.confirmation ? true : undefined}
            />
          </FormField>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField
              id="acc-cost-per-night"
              label="Cost per night"
              error={errors.cost_per_night}
            >
              <input
                id="acc-cost-per-night"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={costPerNight}
                onChange={(e) => setCostPerNight(e.target.value)}
                className={inputClass}
                placeholder="0.00"
                aria-invalid={errors.cost_per_night ? true : undefined}
              />
            </FormField>
            <FormField
              id="acc-total-cost"
              label="Total cost"
              error={errors.total_cost}
            >
              <input
                id="acc-total-cost"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value)}
                className={inputClass}
                placeholder="0.00"
                aria-invalid={errors.total_cost ? true : undefined}
              />
            </FormField>
          </div>

          <FormField
            id="acc-currency"
            label="Currency"
            hint="Required when any cost is entered. Defaults to the trip's base currency."
            error={errors.currency}
          >
            <input
              id="acc-currency"
              list="acc-currency-options"
              type="text"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="ISO 4217"
              aria-invalid={errors.currency ? true : undefined}
            />
            <datalist id="acc-currency-options">
              {COMMON_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </datalist>
          </FormField>

          <FormField id="acc-notes" label="Notes" error={errors.notes}>
            <textarea
              id="acc-notes"
              rows={3}
              maxLength={NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={textareaClass}
              placeholder="Optional"
              aria-invalid={errors.notes ? true : undefined}
            />
          </FormField>

          {formError && (
            <p
              role="alert"
              className="text-sm text-red-600 dark:text-red-400"
            >
              {formError}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={primaryButtonClass}
            >
              {submitting
                ? "Saving…"
                : mode === "create"
                ? "Add accommodation"
                : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type { AccommodationFormProps };
