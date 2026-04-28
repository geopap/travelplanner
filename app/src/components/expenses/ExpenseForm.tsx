"use client";

// B-014 — Create/edit form for a trip expense (drawer-style modal).
//
// Per AC-2 the form captures: category, description, amount, currency,
// occurred_at (within trip range), paid_by (member dropdown), split_among
// (multi-select; equal split → share_pct = 100/N).
//
// Currency is locked to the trip's base_currency (v1: multi-currency
// deferred, server enforces; we render a read-only field with a hint).
//
// `share_pct` summing to 100 is enforced as a client-side safety net; the
// server is authoritative.

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  Expense,
  ExpenseCategory,
  ExpenseCreateDTO,
  ExpensePatchDTO,
  ExpenseSplit,
} from "@/lib/types/expenses";
import type { MemberWithProfile } from "@/lib/types/members";
import { ApiClientError } from "@/lib/utils/api-client";
import { createExpense, updateExpense } from "@/lib/hooks/useExpenses";
import {
  FormField,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  selectClass,
} from "@/components/ui/FormField";

const DESCRIPTION_MAX = 500;

const CATEGORIES: ReadonlyArray<{ value: ExpenseCategory; label: string }> = [
  { value: "accommodation", label: "Accommodation" },
  { value: "transport", label: "Transport" },
  { value: "food", label: "Food" },
  { value: "activities", label: "Activities" },
  { value: "shopping", label: "Shopping" },
  { value: "other", label: "Other" },
];

interface ExpenseFormProps {
  mode: "create" | "edit";
  tripId: string;
  /** YYYY-MM-DD trip bounds — used for the date input min/max. */
  tripStartDate: string;
  tripEndDate: string;
  /** Locked v1; rendered read-only. */
  tripBaseCurrency: string;
  /** UID of the signed-in user — paid_by defaults to this. */
  currentUserId: string;
  /** Accepted trip members — drives paid_by dropdown + split_among options. */
  members: ReadonlyArray<MemberWithProfile>;
  /** When editing, pre-fills the form. */
  initial?: Expense;
  onClose: () => void;
  onSaved: (expense: Expense) => void;
}

interface FormErrors {
  category?: string;
  description?: string;
  amount?: string;
  occurred_at?: string;
  paid_by?: string;
  split_among?: string;
}

function memberDisplayName(m: MemberWithProfile): string {
  return m.profile.full_name?.trim() || m.profile.email;
}

/**
 * Build an equal-split distribution across `userIds`. Each share is
 * 100/N rounded to 2dp; the last share absorbs the rounding remainder so
 * the values sum to exactly 100.
 */
function equalSplit(userIds: string[]): ExpenseSplit[] {
  if (userIds.length === 0) return [];
  const each = Math.round((100 / userIds.length) * 100) / 100;
  const result: ExpenseSplit[] = userIds.map((uid) => ({
    user_id: uid,
    share_pct: each,
  }));
  const sum = result.reduce((acc, s) => acc + s.share_pct, 0);
  const drift = Math.round((100 - sum) * 100) / 100;
  if (drift !== 0 && result.length > 0) {
    result[result.length - 1].share_pct = Math.round(
      (result[result.length - 1].share_pct + drift) * 100,
    ) / 100;
  }
  return result;
}

export function ExpenseForm({
  mode,
  tripId,
  tripStartDate,
  tripEndDate,
  tripBaseCurrency,
  currentUserId,
  members,
  initial,
  onClose,
  onSaved,
}: ExpenseFormProps) {
  const acceptedMembers = useMemo(
    () => members.filter((m) => m.status === "accepted"),
    [members],
  );

  const defaultPaidBy = useMemo(() => {
    if (initial?.paid_by) return initial.paid_by;
    if (acceptedMembers.some((m) => m.user_id === currentUserId)) {
      return currentUserId;
    }
    return acceptedMembers[0]?.user_id ?? "";
  }, [initial, acceptedMembers, currentUserId]);

  const defaultSplitIds = useMemo(() => {
    if (initial?.split_among && initial.split_among.length > 0) {
      // Filter to currently-accepted members only — a removed member's
      // share would be rejected by the API otherwise.
      const accepted = new Set(acceptedMembers.map((m) => m.user_id));
      return initial.split_among
        .map((s) => s.user_id)
        .filter((id) => accepted.has(id));
    }
    return acceptedMembers.map((m) => m.user_id);
  }, [initial, acceptedMembers]);

  const [category, setCategory] = useState<ExpenseCategory>(
    initial?.category ?? "food",
  );
  const [description, setDescription] = useState<string>(
    initial?.description ?? "",
  );
  const [amount, setAmount] = useState<string>(
    initial?.amount !== undefined && initial?.amount !== null
      ? String(initial.amount)
      : "",
  );
  const [occurredAt, setOccurredAt] = useState<string>(
    initial?.occurred_at ?? tripStartDate,
  );
  const [paidBy, setPaidBy] = useState<string>(defaultPaidBy);
  const [splitIds, setSplitIds] = useState<string[]>(defaultSplitIds);

  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

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

  function toggleSplit(userId: string) {
    setSplitIds((curr) =>
      curr.includes(userId)
        ? curr.filter((id) => id !== userId)
        : [...curr, userId],
    );
  }

  function validate(): { payload?: ExpenseCreateDTO; fieldErrors: FormErrors } {
    const fe: FormErrors = {};

    const trimmedDesc = description.trim();
    if (trimmedDesc.length === 0) {
      fe.description = "Description is required.";
    } else if (trimmedDesc.length > DESCRIPTION_MAX) {
      fe.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
    }

    let amountNum: number | null = null;
    if (amount.trim() === "") {
      fe.amount = "Amount is required.";
    } else {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fe.amount = "Amount must be greater than 0.";
      } else if (Math.round(parsed * 100) / 100 !== parsed) {
        fe.amount = "Amount may have at most 2 decimal places.";
      } else {
        amountNum = Math.round(parsed * 100) / 100;
      }
    }

    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDate.test(occurredAt)) {
      fe.occurred_at = "Choose a date.";
    } else if (occurredAt < tripStartDate || occurredAt > tripEndDate) {
      fe.occurred_at = `Date must be within trip dates (${tripStartDate} – ${tripEndDate}).`;
    }

    const paidByValid = acceptedMembers.some((m) => m.user_id === paidBy);
    if (!paidByValid) {
      fe.paid_by = "Choose who paid.";
    }

    if (splitIds.length === 0) {
      fe.split_among = "Select at least one person to split among.";
    } else {
      const accepted = new Set(acceptedMembers.map((m) => m.user_id));
      if (splitIds.some((id) => !accepted.has(id))) {
        fe.split_among = "All selected members must be on this trip.";
      }
    }

    if (Object.keys(fe).length > 0 || amountNum === null) {
      return { fieldErrors: fe };
    }

    const split_among = equalSplit(splitIds);
    // Belt-and-braces: the helper rounds, but verify the sum.
    const sum = split_among.reduce((acc, s) => acc + s.share_pct, 0);
    if (Math.abs(sum - 100) > 0.01) {
      fe.split_among = "Internal split rounding error — please retry.";
      return { fieldErrors: fe };
    }

    const payload: ExpenseCreateDTO = {
      category,
      description: trimmedDesc,
      amount: amountNum,
      currency: tripBaseCurrency,
      occurred_at: occurredAt,
      paid_by: paidBy,
      split_among,
    };
    return { payload, fieldErrors: fe };
  }

  function mapServerCode(code: string, fallback: string): string {
    switch (code) {
      case "date_out_of_range":
        return `Date must fall within trip dates (${tripStartDate} – ${tripEndDate}).`;
      case "invalid_currency":
        return `Expenses must be in the trip base currency (${tripBaseCurrency}).`;
      case "member_not_in_trip":
        return "One or more selected members are no longer on this trip.";
      default:
        return fallback;
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);

    const { payload, fieldErrors } = validate();
    if (Object.keys(fieldErrors).length > 0 || !payload) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      if (mode === "create") {
        const created = await createExpense(tripId, payload);
        onSaved(created);
      } else if (initial) {
        // Send the full payload as a PATCH — server treats unspecified
        // fields as untouched but we always send all fields to keep the
        // edit semantics simple.
        const patch: ExpensePatchDTO = payload;
        const updated = await updateExpense(tripId, initial.id, patch);
        onSaved(updated);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        const targeted = mapServerCode(err.code, err.message);
        if (err.code === "date_out_of_range") {
          setErrors((prev) => ({ ...prev, occurred_at: targeted }));
        } else if (err.code === "member_not_in_trip") {
          setErrors((prev) => ({ ...prev, split_among: targeted }));
        } else {
          setFormError(targeted);
        }
      } else {
        setFormError("Could not save the expense. Please try again.");
      }
      setSubmitting(false);
    }
  }

  const titleId = "expense-form-title";
  const equalShare =
    splitIds.length > 0
      ? Math.round((100 / splitIds.length) * 100) / 100
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
    >
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl">
        <form onSubmit={onSubmit} noValidate className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            >
              {mode === "create" ? "Add expense" : "Edit expense"}
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

          <FormField
            id="exp-category"
            label="Category"
            required
            error={errors.category}
          >
            <select
              id="exp-category"
              ref={firstFieldRef}
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
              className={selectClass}
              aria-invalid={errors.category ? true : undefined}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="exp-description"
            label="Description"
            required
            error={errors.description}
          >
            <input
              id="exp-description"
              type="text"
              maxLength={DESCRIPTION_MAX}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              placeholder="e.g. Dinner at Ichiran"
              aria-invalid={errors.description ? true : undefined}
            />
          </FormField>

          <div className="grid sm:grid-cols-2 gap-4">
            <FormField
              id="exp-amount"
              label="Amount"
              required
              error={errors.amount}
            >
              <input
                id="exp-amount"
                type="number"
                inputMode="decimal"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClass}
                placeholder="0.00"
                aria-invalid={errors.amount ? true : undefined}
              />
            </FormField>
            <FormField
              id="exp-currency"
              label="Currency"
              hint="v1: expenses in trip base currency only."
            >
              <input
                id="exp-currency"
                type="text"
                value={tripBaseCurrency}
                readOnly
                className={`${inputClass} bg-zinc-100 dark:bg-zinc-800 cursor-not-allowed`}
                aria-readonly="true"
              />
            </FormField>
          </div>

          <FormField
            id="exp-occurred-at"
            label="Date"
            required
            error={errors.occurred_at}
          >
            <input
              id="exp-occurred-at"
              type="date"
              required
              min={tripStartDate}
              max={tripEndDate}
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className={inputClass}
              aria-invalid={errors.occurred_at ? true : undefined}
            />
          </FormField>

          <FormField
            id="exp-paid-by"
            label="Paid by"
            required
            error={errors.paid_by}
          >
            <select
              id="exp-paid-by"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className={selectClass}
              aria-invalid={errors.paid_by ? true : undefined}
            >
              {acceptedMembers.length === 0 && (
                <option value="">No accepted members</option>
              )}
              {acceptedMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {memberDisplayName(m)}
                  {m.user_id === currentUserId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            id="exp-split-among"
            label="Split among"
            hint={
              splitIds.length > 0
                ? `Equal split — ${equalShare.toFixed(2)}% each (${splitIds.length} member${splitIds.length === 1 ? "" : "s"}).`
                : "Select at least one person."
            }
            error={errors.split_among}
          >
            <div
              id="exp-split-among"
              role="group"
              aria-label="Split among"
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-800 max-h-48 overflow-y-auto"
            >
              {acceptedMembers.length === 0 && (
                <p className="px-3 py-2 text-sm text-zinc-500">
                  No accepted members on this trip.
                </p>
              )}
              {acceptedMembers.map((m) => {
                const checked = splitIds.includes(m.user_id);
                const id = `exp-split-${m.user_id}`;
                return (
                  <label
                    key={m.user_id}
                    htmlFor={id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSplit(m.user_id)}
                      className="h-4 w-4 accent-zinc-900 dark:accent-zinc-50"
                    />
                    <span className="text-sm text-zinc-800 dark:text-zinc-200">
                      {memberDisplayName(m)}
                      {m.user_id === currentUserId && (
                        <span className="text-zinc-500"> (you)</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
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
              disabled={submitting || acceptedMembers.length === 0}
              className={primaryButtonClass}
            >
              {submitting
                ? "Saving…"
                : mode === "create"
                ? "Add expense"
                : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type { ExpenseFormProps };
