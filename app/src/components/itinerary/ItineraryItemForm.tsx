"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  ItineraryItem,
  ItineraryItemType,
} from "@/lib/types/domain";
import type {
  Transportation,
  TransportationInsertDTO,
  TransportationPatchDTO,
} from "@/lib/types/transportation";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { COMMON_CURRENCIES } from "@/lib/utils/currencies";
import {
  isoToLocalInputValue,
  localInputToIsoWithOffset,
} from "@/lib/utils/format";
import {
  FormField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
  textareaClass,
} from "@/components/ui/FormField";
import { ItemTypePicker } from "./ItemTypePicker";
import {
  TransportFields,
  emptyTransportFieldsValue,
  type TransportFieldErrors,
  type TransportFieldsValue,
} from "./TransportFields";
import { PlaceSearchInput } from "@/components/places/PlaceSearchInput";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PlaceSearchResult } from "@/lib/hooks/usePlaceSearch";

interface ItineraryItemFormProps {
  mode: "create" | "edit";
  tripId: string;
  dayId: string;
  dayDate: string; // YYYY-MM-DD
  tripBaseCurrency: string;
  initial?: ItineraryItem;
  /** Pre-fetched transportation row when editing a transport-type item. */
  initialTransportation?: Transportation | null;
  onClose: () => void;
  onSaved: (
    item: ItineraryItem,
    transportation?: Transportation | null,
  ) => void;
}

interface ItemResponse {
  item: ItineraryItem;
  transportation?: Transportation | null;
}

/**
 * Drawer-style form for creating or editing an itinerary item.
 * trip_id and day_id are taken from props (URL context) and passed on the path,
 * never from the form body.
 *
 * For type='transport', the form renders <TransportFields/> and submits a
 * discriminated-union payload with a nested `transportation` object. The
 * parent's cost/currency inputs are hidden (AC-10).
 */
export function ItineraryItemForm({
  mode,
  tripId,
  dayId,
  dayDate,
  tripBaseCurrency,
  initial,
  initialTransportation,
  onClose,
  onSaved,
}: ItineraryItemFormProps) {
  const [type, setType] = useState<ItineraryItemType>(
    initial?.type ?? "activity",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startTime, setStartTime] = useState<string>(
    initial?.start_time ? isoToLocalInputValue(initial.start_time) : "",
  );
  const [endTime, setEndTime] = useState<string>(
    initial?.end_time ? isoToLocalInputValue(initial.end_time) : "",
  );
  const [cost, setCost] = useState<string>(
    initial?.cost !== null && initial?.cost !== undefined
      ? String(initial.cost)
      : "",
  );
  const [currency, setCurrency] = useState<string>(
    initial?.currency ?? tripBaseCurrency,
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [transport, setTransport] = useState<TransportFieldsValue>(() => {
    if (initialTransportation) {
      return {
        mode: initialTransportation.mode,
        carrier: initialTransportation.carrier ?? "",
        confirmation: initialTransportation.confirmation ?? "",
        departure_location: initialTransportation.departure_location ?? "",
        arrival_location: initialTransportation.arrival_location ?? "",
        departure_time: isoToLocalInputValue(initialTransportation.departure_time),
        arrival_time: isoToLocalInputValue(initialTransportation.arrival_time),
        cost:
          initialTransportation.cost !== null
            ? String(initialTransportation.cost)
            : "",
        currency: initialTransportation.currency ?? tripBaseCurrency,
        flight_number: initialTransportation.flight_number ?? "",
      };
    }
    return emptyTransportFieldsValue(tripBaseCurrency);
  });

  // B-015 — Optional place link. Initialised from the embedded `place` (when
  // editing an item that already has one). The picker resolves the user's
  // selection to a `places.id` UUID via the cache (RLS allows authenticated
  // SELECT on `public.places`).
  const [linkedPlace, setLinkedPlace] = useState<{
    place_id: string;
    name: string;
  } | null>(
    initial && initial.place_id && initial.place
      ? { place_id: initial.place_id, name: initial.place.name }
      : null,
  );
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [placeResolving, setPlaceResolving] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [transportErrors, setTransportErrors] = useState<TransportFieldErrors>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

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

  const isTransport = type === "transport";

  /**
   * B-015 — Resolve a Google place selection to a `places.id` UUID.
   * Strategy:
   *   1. Hit `GET /api/places/[googlePlaceId]` so the cache is warm (server-side
   *      proxy upserts on miss).
   *   2. Look up the UUID via the browser Supabase client. `places` is readable
   *      by any authenticated user (RLS policy `places_select_authenticated`).
   * If anything fails, keep the form usable — surface a small error but don't
   * block submission (the link is optional).
   */
  async function onPickPlace(selected: PlaceSearchResult): Promise<void> {
    setPlaceError(null);
    setPlaceResolving(true);
    try {
      // 1. Warm the cache. The proxy returns 200 with the row OR a fallback
      // shape; either way the `places` row is upserted server-side.
      await apiFetch<unknown>(
        `/api/places/${encodeURIComponent(selected.google_place_id)}`,
        { method: "GET" },
      ).catch(() => {
        // Cache warm is best-effort; the lookup below still works if the row
        // was previously cached.
      });

      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("places")
        .select("id,name")
        .eq("google_place_id", selected.google_place_id)
        .maybeSingle<{ id: string; name: string }>();
      if (error || !data) {
        setPlaceError(
          "Could not link that place. Open it from Places once, then try again.",
        );
        return;
      }
      setLinkedPlace({ place_id: data.id, name: data.name });
      setPlacePickerOpen(false);
    } catch {
      setPlaceError("Could not link that place. Please try again.");
    } finally {
      setPlaceResolving(false);
    }
  }

  function clearLinkedPlace(): void {
    setLinkedPlace(null);
    setPlaceError(null);
  }

  function buildTransportPayload(): {
    payload?: TransportationInsertDTO;
    errors: TransportFieldErrors;
  } {
    const tErrors: TransportFieldErrors = {};

    const depIso = transport.departure_time
      ? localInputToIsoWithOffset(transport.departure_time)
      : null;
    if (transport.departure_time && depIso === null) {
      tErrors.departure_time = "Invalid departure time.";
    }
    const arrIso = transport.arrival_time
      ? localInputToIsoWithOffset(transport.arrival_time)
      : null;
    if (transport.arrival_time && arrIso === null) {
      tErrors.arrival_time = "Invalid arrival time.";
    }
    if (depIso && arrIso && Date.parse(arrIso) < Date.parse(depIso)) {
      tErrors.arrival_time = "Arrival must be on or after departure.";
    }

    let costNumber: number | null = null;
    if (transport.cost.trim() !== "") {
      const parsed = Number(transport.cost);
      if (Number.isNaN(parsed) || parsed < 0) {
        tErrors.cost = "Cost must be a positive number.";
      } else {
        costNumber = parsed;
      }
    }
    if (costNumber !== null && !/^[A-Z]{3}$/.test(transport.currency)) {
      tErrors.currency = "Enter a 3-letter ISO 4217 code.";
    }

    const flightNumberTrimmed = transport.flight_number.trim();
    if (flightNumberTrimmed.length > 16) {
      tErrors.flight_number = "Flight number is too long (max 16).";
    }

    if (Object.keys(tErrors).length > 0) {
      return { errors: tErrors };
    }

    const payload: TransportationInsertDTO = { mode: transport.mode };
    const carrier = transport.carrier.trim();
    if (carrier) payload.carrier = carrier;
    const confirmation = transport.confirmation.trim();
    if (confirmation) payload.confirmation = confirmation;
    const dep = transport.departure_location.trim();
    if (dep) payload.departure_location = dep;
    const arr = transport.arrival_location.trim();
    if (arr) payload.arrival_location = arr;
    if (depIso) payload.departure_time = depIso;
    if (arrIso) payload.arrival_time = arrIso;
    if (costNumber !== null) {
      payload.cost = costNumber;
      payload.currency = transport.currency;
    }
    // B-029 — only send flight_number when this is actually a flight AND the
    // user typed something. The DB column persists across mode toggles, so
    // for non-flight modes we deliberately leave it untouched on create. On
    // patch the explicit null below handles the clear case.
    if (transport.mode === "flight" && flightNumberTrimmed) {
      payload.flight_number = flightNumberTrimmed;
    }
    return { payload, errors: tErrors };
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const fieldErrors: Record<string, string> = {};

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) fieldErrors.title = "Title is required.";
    else if (trimmedTitle.length > 200)
      fieldErrors.title = "Title is too long (max 200).";

    let startIso: string | null = null;
    let endIso: string | null = null;
    if (startTime) {
      const parsed = localInputToIsoWithOffset(startTime);
      if (!parsed) fieldErrors.start_time = "Invalid start time.";
      else startIso = parsed;
    }
    if (endTime) {
      const parsed = localInputToIsoWithOffset(endTime);
      if (!parsed) fieldErrors.end_time = "Invalid end time.";
      else endIso = parsed;
    }
    if (startIso && endIso && Date.parse(endIso) < Date.parse(startIso)) {
      fieldErrors.end_time = "End time must be at or after start time.";
    }

    let costNumber: number | null = null;
    if (!isTransport && cost.trim() !== "") {
      const parsed = Number(cost);
      if (Number.isNaN(parsed) || parsed < 0)
        fieldErrors.cost = "Cost must be a positive number.";
      else costNumber = parsed;
    }
    if (!isTransport && costNumber !== null && !/^[A-Z]{3}$/.test(currency)) {
      fieldErrors.currency = "Enter a 3-letter ISO 4217 code.";
    }

    let transportPayload: TransportationInsertDTO | undefined;
    let nextTransportErrors: TransportFieldErrors = {};
    if (isTransport) {
      const built = buildTransportPayload();
      nextTransportErrors = built.errors;
      transportPayload = built.payload;
    }

    if (
      Object.keys(fieldErrors).length > 0 ||
      Object.keys(nextTransportErrors).length > 0
    ) {
      setErrors(fieldErrors);
      setTransportErrors(nextTransportErrors);
      // Move focus to the form error region for keyboard users.
      firstFieldRef.current?.focus();
      return;
    }

    setErrors({});
    setTransportErrors({});
    setSubmitting(true);
    try {
      // Build the discriminated-union body. Transport variant nests the sub-object
      // and never sends cost/currency on the parent (AC-10).
      const baseBody: Record<string, unknown> = {
        title: trimmedTitle,
        day_id: dayId,
        start_time: startIso,
        end_time: endIso,
        notes: notes.trim() || null,
      };
      // B-015 — include `place_id` only when the user explicitly changed it,
      // and only for non-transport items (the transport RPC ignores it; the
      // picker is hidden for transport anyway).
      if (!isTransport) {
        if (mode === "create") {
          if (linkedPlace) baseBody.place_id = linkedPlace.place_id;
        } else {
          const previous = initial?.place_id ?? null;
          const current = linkedPlace?.place_id ?? null;
          if (previous !== current) baseBody.place_id = current;
        }
      }

      let body: Record<string, unknown>;
      if (isTransport) {
        if (!transportPayload) {
          // Defensive — buildTransportPayload only returns undefined when errors exist.
          setFormError("Transport details are incomplete.");
          setSubmitting(false);
          return;
        }
        if (mode === "create") {
          body = {
            ...baseBody,
            type: "transport",
            transportation: transportPayload,
          };
        } else {
          // PATCH: send a TransportationPatchDTO that nulls fields the user cleared.
          const patch: TransportationPatchDTO = {
            mode: transportPayload.mode,
            carrier: transportPayload.carrier ?? null,
            confirmation: transportPayload.confirmation ?? null,
            departure_location: transportPayload.departure_location ?? null,
            arrival_location: transportPayload.arrival_location ?? null,
            departure_time: transportPayload.departure_time ?? null,
            arrival_time: transportPayload.arrival_time ?? null,
            cost: transportPayload.cost ?? null,
            currency: transportPayload.currency ?? null,
            // B-029 — explicit null clears the column when the user emptied
            // the input or switched away from flight mode.
            flight_number: transportPayload.flight_number ?? null,
          };
          body = {
            ...baseBody,
            type: "transport",
            transportation: patch,
          };
        }
      } else {
        body = {
          ...baseBody,
          type,
          cost: costNumber,
          currency: costNumber !== null ? currency : null,
        };
      }

      const path =
        mode === "create"
          ? `/api/trips/${tripId}/items`
          : `/api/trips/${tripId}/items/${initial?.id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const res = await apiFetch<ItemResponse>(path, {
        method,
        body,
      });
      onSaved(res.item, res.transportation ?? null);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not save the item. Please try again.";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-form-title"
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
    >
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl">
        <form onSubmit={onSubmit} noValidate className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2
                id="item-form-title"
                className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
              >
                {mode === "create" ? "Add item" : "Edit item"}
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                On day starting {dayDate}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 text-xl leading-none -mt-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {formError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
            >
              {formError}
            </div>
          )}

          <div className="mt-5 space-y-4">
            <div>
              <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-1.5">
                Type
              </span>
              <ItemTypePicker
                value={type}
                onChange={setType}
                disabled={submitting}
              />
            </div>

            <FormField id="title" label="Title" required error={errors.title}>
              <input
                ref={firstFieldRef}
                id="title"
                name="title"
                type="text"
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
                placeholder={
                  isTransport
                    ? "e.g. Zurich → Tokyo"
                    : "e.g. Dinner at Narisawa"
                }
                aria-required="true"
                aria-invalid={errors.title ? true : undefined}
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id="start_time"
                label="Start"
                hint="Optional"
                error={errors.start_time}
              >
                <input
                  id="start_time"
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={inputClass}
                  aria-invalid={errors.start_time ? true : undefined}
                />
              </FormField>
              <FormField
                id="end_time"
                label="End"
                hint="Optional"
                error={errors.end_time}
              >
                <input
                  id="end_time"
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={inputClass}
                  aria-invalid={errors.end_time ? true : undefined}
                />
              </FormField>
            </div>

            {/* B-015 — Optional place link. Hidden for transport (use dep/arr
                locations instead). Resolves via /api/places + browser Supabase
                lookup; selection is best-effort and never blocks submit. */}
            {!isTransport && (
              <div>
                <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200 mb-1.5">
                  Place{" "}
                  <span className="font-normal text-zinc-500">
                    (optional — shows a pin on the day map)
                  </span>
                </span>
                {linkedPlace && !placePickerOpen ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm">
                    <span className="truncate text-zinc-900 dark:text-zinc-100">
                      📍 {linkedPlace.name}
                    </span>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPlacePickerOpen(true)}
                        disabled={submitting}
                        className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={clearLinkedPlace}
                        disabled={submitting}
                        className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : placePickerOpen || !linkedPlace ? (
                  <div className="space-y-2">
                    <PlaceSearchInput
                      onSelect={(p) => {
                        void onPickPlace(p);
                      }}
                      placeholder="Search for a place…"
                    />
                    {placeResolving && (
                      <p className="text-xs text-zinc-500">Linking place…</p>
                    )}
                    {placeError && (
                      <p
                        role="alert"
                        className="text-xs text-red-600 dark:text-red-400"
                      >
                        {placeError}
                      </p>
                    )}
                    {linkedPlace && placePickerOpen && (
                      <button
                        type="button"
                        onClick={() => setPlacePickerOpen(false)}
                        className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:underline"
                      >
                        Cancel change
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {/* Cost/currency hidden for transport — they live on the transportation row. */}
            {!isTransport && (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="cost" label="Cost" error={errors.cost}>
                  <input
                    id="cost"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                    aria-invalid={errors.cost ? true : undefined}
                  />
                </FormField>
                <FormField
                  id="currency"
                  label="Currency"
                  error={errors.currency}
                >
                  <select
                    id="currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className={selectClass}
                    aria-invalid={errors.currency ? true : undefined}
                  >
                    {COMMON_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            )}

            <FormField id="notes" label="Notes" error={errors.notes}>
              <textarea
                id="notes"
                rows={3}
                maxLength={5000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={textareaClass}
                placeholder="Confirmation numbers, addresses, reminders…"
              />
            </FormField>

            {isTransport && (
              <TransportFields
                value={transport}
                onChange={setTransport}
                errors={transportErrors}
                disabled={submitting}
              />
            )}
          </div>

          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
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
                ? "Add item"
                : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
