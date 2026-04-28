"use client";

// B-007 — sub-form rendered inside ItineraryItemForm when type === 'transport'.
// Owns: mode, carrier, confirmation, departure/arrival location + datetime,
// cost, currency. The parent form hides its own cost/currency inputs in this
// case (AC-10 — cost lives only on the transportation row).

import type { TransportMode } from "@/lib/types/transportation";
import { TransportMode as TransportModeSchema } from "@/lib/validations/transportation";
import { COMMON_CURRENCIES } from "@/lib/utils/currencies";
import {
  FormField,
  inputClass,
  selectClass,
} from "@/components/ui/FormField";

export interface TransportFieldErrors {
  mode?: string;
  carrier?: string;
  confirmation?: string;
  departure_location?: string;
  arrival_location?: string;
  departure_time?: string;
  arrival_time?: string;
  cost?: string;
  currency?: string;
}

export interface TransportFieldsValue {
  mode: TransportMode;
  carrier: string;
  confirmation: string;
  departure_location: string;
  arrival_location: string;
  departure_time: string; // datetime-local string
  arrival_time: string; // datetime-local string
  cost: string; // raw input
  currency: string; // ISO 4217
}

const MODE_OPTIONS: ReadonlyArray<{ value: TransportMode; label: string }> = [
  { value: "flight", label: "Flight" },
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
  { value: "car", label: "Car" },
  { value: "ferry", label: "Ferry" },
];

interface TransportFieldsProps {
  value: TransportFieldsValue;
  onChange: (next: TransportFieldsValue) => void;
  errors: TransportFieldErrors;
  disabled?: boolean;
}

export function TransportFields({
  value,
  onChange,
  errors,
  disabled,
}: TransportFieldsProps) {
  function patch<K extends keyof TransportFieldsValue>(
    key: K,
    next: TransportFieldsValue[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  const costNumber = value.cost.trim() === "" ? null : Number(value.cost);
  const costInvalid =
    costNumber !== null && (Number.isNaN(costNumber) || costNumber < 0);

  return (
    <fieldset
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4"
      disabled={disabled}
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        Transport details
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="transport_mode" label="Mode" required error={errors.mode}>
          <select
            id="transport_mode"
            value={value.mode}
            onChange={(e) => {
              const parsed = TransportModeSchema.safeParse(e.target.value);
              if (parsed.success) patch("mode", parsed.data);
            }}
            className={selectClass}
            aria-required="true"
            aria-invalid={errors.mode ? true : undefined}
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          id="transport_carrier"
          label="Carrier / Operator"
          hint="Optional"
          error={errors.carrier}
        >
          <input
            id="transport_carrier"
            type="text"
            maxLength={120}
            value={value.carrier}
            onChange={(e) => patch("carrier", e.target.value)}
            className={inputClass}
            placeholder="e.g. Swiss, JR East"
            aria-invalid={errors.carrier ? true : undefined}
          />
        </FormField>
      </div>

      <FormField
        id="transport_confirmation"
        label="Confirmation / Booking ref"
        hint="Optional"
        error={errors.confirmation}
      >
        <input
          id="transport_confirmation"
          type="text"
          maxLength={80}
          value={value.confirmation}
          onChange={(e) => patch("confirmation", e.target.value)}
          className={inputClass}
          placeholder="e.g. ABC123"
          autoComplete="off"
          aria-invalid={errors.confirmation ? true : undefined}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="transport_departure_location"
          label="From"
          hint="Optional"
          error={errors.departure_location}
        >
          <input
            id="transport_departure_location"
            type="text"
            maxLength={200}
            value={value.departure_location}
            onChange={(e) => patch("departure_location", e.target.value)}
            className={inputClass}
            placeholder="e.g. Zurich Airport"
            aria-invalid={errors.departure_location ? true : undefined}
          />
        </FormField>
        <FormField
          id="transport_arrival_location"
          label="To"
          hint="Optional"
          error={errors.arrival_location}
        >
          <input
            id="transport_arrival_location"
            type="text"
            maxLength={200}
            value={value.arrival_location}
            onChange={(e) => patch("arrival_location", e.target.value)}
            className={inputClass}
            placeholder="e.g. Tokyo Haneda"
            aria-invalid={errors.arrival_location ? true : undefined}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="transport_departure_time"
          label="Departure"
          hint="Local time"
          error={errors.departure_time}
        >
          <input
            id="transport_departure_time"
            type="datetime-local"
            value={value.departure_time}
            onChange={(e) => patch("departure_time", e.target.value)}
            className={inputClass}
            aria-invalid={errors.departure_time ? true : undefined}
          />
        </FormField>
        <FormField
          id="transport_arrival_time"
          label="Arrival"
          hint="Local time"
          error={errors.arrival_time}
        >
          <input
            id="transport_arrival_time"
            type="datetime-local"
            value={value.arrival_time}
            onChange={(e) => patch("arrival_time", e.target.value)}
            className={inputClass}
            aria-invalid={errors.arrival_time ? true : undefined}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="transport_cost"
          label="Cost"
          hint="Optional"
          error={errors.cost}
        >
          <input
            id="transport_cost"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={value.cost}
            onChange={(e) => patch("cost", e.target.value)}
            className={inputClass}
            placeholder="0.00"
            aria-invalid={errors.cost || costInvalid ? true : undefined}
          />
        </FormField>
        <FormField
          id="transport_currency"
          label="Currency"
          error={errors.currency}
        >
          <select
            id="transport_currency"
            value={value.currency}
            onChange={(e) => patch("currency", e.target.value)}
            className={selectClass}
            aria-invalid={errors.currency ? true : undefined}
          >
            {COMMON_CURRENCIES.some((c) => c.code === value.currency)
              ? null
              : (
                <option value={value.currency}>{value.currency}</option>
              )}
            {COMMON_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </FormField>
      </div>
    </fieldset>
  );
}

export function emptyTransportFieldsValue(
  tripBaseCurrency: string,
): TransportFieldsValue {
  return {
    mode: "flight",
    carrier: "",
    confirmation: "",
    departure_location: "",
    arrival_location: "",
    departure_time: "",
    arrival_time: "",
    cost: "",
    currency: /^[A-Z]{3}$/.test(tripBaseCurrency) ? tripBaseCurrency : "USD",
  };
}
