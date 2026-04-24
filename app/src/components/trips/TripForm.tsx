"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type {
  DateShrinkBlockingDay,
  Trip,
  TripDay,
} from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { validateTripDates } from "@/lib/utils/validation";
import { COMMON_CURRENCIES } from "@/lib/utils/currencies";
import { formatShortDate } from "@/lib/utils/format";
import {
  FormField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
} from "@/components/ui/FormField";

type TripFormMode = "create" | "edit";

interface TripFormProps {
  mode: TripFormMode;
  initial?: Trip;
}

interface CreateResponse {
  trip: Trip;
  days: TripDay[];
}

interface UpdateResponse {
  trip: Trip;
}

export function TripForm({ mode, initial }: TripFormProps) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const [name, setName] = useState(initial?.name ?? "");
  const [startDate, setStartDate] = useState(initial?.start_date ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [baseCurrency, setBaseCurrency] = useState(
    initial?.base_currency ?? "CHF",
  );
  const [totalBudget, setTotalBudget] = useState<string>(
    initial?.total_budget !== null && initial?.total_budget !== undefined
      ? String(initial.total_budget)
      : "",
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [blockingDays, setBlockingDays] = useState<DateShrinkBlockingDay[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setBlockingDays([]);
    const fieldErrors: Record<string, string> = {};

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      fieldErrors.name = "Trip name is required.";
    } else if (trimmedName.length > 160) {
      fieldErrors.name = "Trip name is too long.";
    }

    const dateErr = validateTripDates(startDate, endDate);
    if (dateErr) {
      fieldErrors.end_date = dateErr;
    }

    if (!/^[A-Z]{3}$/.test(baseCurrency)) {
      fieldErrors.base_currency =
        "Use a 3-letter ISO 4217 code (e.g. CHF, EUR, USD).";
    }

    let budgetNumber: number | null = null;
    if (totalBudget.trim() !== "") {
      const parsed = Number(totalBudget);
      if (Number.isNaN(parsed) || parsed < 0) {
        fieldErrors.total_budget = "Budget must be a positive number.";
      } else {
        budgetNumber = parsed;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      if (isEdit && initial) {
        const body: Record<string, unknown> = {
          name: trimmedName,
          start_date: startDate,
          end_date: endDate,
          destination: destination.trim() || null,
          base_currency: baseCurrency,
          total_budget: budgetNumber,
        };
        const res = await apiFetch<UpdateResponse>(
          `/api/trips/${initial.id}`,
          { method: "PATCH", body },
        );
        router.replace(`/trips/${res.trip.id}`);
        router.refresh();
      } else {
        const body = {
          name: trimmedName,
          start_date: startDate,
          end_date: endDate,
          destination: destination.trim() || null,
          base_currency: baseCurrency,
          total_budget: budgetNumber,
        };
        const res = await apiFetch<CreateResponse>("/api/trips", {
          method: "POST",
          body,
        });
        router.replace(`/trips/${res.trip.id}`);
        router.refresh();
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "date_shrink_blocked") {
          const details = err.details as
            | { blocking_days?: DateShrinkBlockingDay[] }
            | undefined;
          setBlockingDays(details?.blocking_days ?? []);
          setFormError(
            "Cannot shrink trip dates: some items fall on days that would be removed.",
          );
        } else if (err.status === 409) {
          setFormError(err.message);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError("Network error. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8 shadow-sm"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {isEdit ? "Edit trip" : "New trip"}
      </h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {isEdit
          ? "Update trip details. Changing dates will add or remove trip days."
          : "Give your trip a name and dates. You can add places, items and a budget later."}
      </p>

      {formError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300"
        >
          <p>{formError}</p>
          {blockingDays.length > 0 && (
            <ul className="mt-2 space-y-0.5 list-disc list-inside">
              {blockingDays.map((d) => (
                <li key={d.day_id}>
                  {formatShortDate(d.date)} — {d.item_count}{" "}
                  {d.item_count === 1 ? "item" : "items"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4">
        <FormField id="name" label="Trip name" required error={errors.name}>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            placeholder="e.g. Japan 2026"
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="start_date"
            label="Start date"
            required
            error={errors.start_date}
          >
            <input
              id="start_date"
              name="start_date"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </FormField>

          <FormField
            id="end_date"
            label="End date"
            required
            error={errors.end_date}
          >
            <input
              id="end_date"
              name="end_date"
              type="date"
              required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </FormField>
        </div>

        <FormField
          id="destination"
          label="Destination"
          hint="Optional — city, country or region."
          error={errors.destination}
        >
          <input
            id="destination"
            name="destination"
            type="text"
            maxLength={200}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className={inputClass}
            placeholder="e.g. Tokyo, Japan"
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="base_currency"
            label="Base currency"
            required
            error={errors.base_currency}
            hint="All trip totals are shown in this currency."
          >
            <select
              id="base_currency"
              name="base_currency"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
              className={selectClass}
            >
              {COMMON_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="total_budget"
            label="Total budget"
            hint="Optional. Numbers only, in the base currency."
            error={errors.total_budget}
          >
            <input
              id="total_budget"
              name="total_budget"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={totalBudget}
              onChange={(e) => setTotalBudget(e.target.value)}
              className={inputClass}
              placeholder="e.g. 5000"
            />
          </FormField>
        </div>
      </div>

      <div className="mt-8 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
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
            : isEdit
            ? "Save changes"
            : "Create trip"}
        </button>
      </div>

      {isEdit && (
        <p
          id="notes-extra"
          className="sr-only"
        >
          Use the Back button in your browser to navigate away without saving.
        </p>
      )}

      {!isEdit && (
        <p className="mt-4 text-xs text-zinc-500">
          Trips are capped at 365 days. Need longer? Break it into phases.
        </p>
      )}
    </form>
  );
}
