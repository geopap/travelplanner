"use client";

// B-014 AC-6 + AC-10 — Budget vs spent + per-member balances summary.
//
// Two modes:
//   - "full" (Budget page): full table of balances, large numbers.
//   - "compact" (Trip overview): condensed; fewer details; "Open budget" link.
//
// Numbers come from two separate endpoints:
//   - GET /api/trips/[id]/expenses — for `total_spent` (also returns the list).
//   - GET /api/trips/[id]/balances — for per-member paid/owes/net.
//
// Both are cheap, server-aggregated calls (no N+1; balances uses an RPC).

import Link from "next/link";
import type { TripBalance } from "@/lib/types/expenses";
import { useExpenses } from "@/lib/hooks/useExpenses";
import { useBalances } from "@/lib/hooks/useBalances";
import { formatCurrency } from "@/lib/utils/format";
import { SkeletonCard } from "@/components/Skeletons";
import { secondaryButtonClass } from "@/components/ui/FormField";

interface ExpensesSummaryProps {
  tripId: string;
  /** Trip total budget; null when not set (AC-6 hides remaining when null). */
  totalBudget: number | null;
  tripBaseCurrency: string;
  variant?: "full" | "compact";
}

export function ExpensesSummary({
  tripId,
  totalBudget,
  tripBaseCurrency,
  variant = "full",
}: ExpensesSummaryProps) {
  // The hooks already re-fetch when `tripId` changes; we lift that pattern
  // by remounting via the `key` prop on the parent when needed.
  const expenses = useExpenses(tripId, { limit: 1 });
  const balances = useBalances(tripId);

  const loading = expenses.status === "loading" || balances.status === "loading";
  const errored = expenses.status === "error" || balances.status === "error";

  if (loading && variant === "compact") {
    return (
      <section
        aria-labelledby="budget-summary-heading-compact"
        className="mt-10"
      >
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2
            id="budget-summary-heading-compact"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Budget
          </h2>
        </div>
        <SkeletonCard />
      </section>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3" role="status" aria-live="polite">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (errored) {
    const errMsg = expenses.error ?? balances.error ?? "Could not load budget.";
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-4 text-sm text-red-700 dark:text-red-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
      >
        <span>{errMsg}</span>
        <button
          type="button"
          onClick={() => {
            void expenses.refetch();
            void balances.refetch();
          }}
          className={secondaryButtonClass}
        >
          Retry
        </button>
      </div>
    );
  }

  const spent = expenses.totalSpent;
  const remaining =
    totalBudget !== null ? totalBudget - spent : null;
  const overBudget = remaining !== null && remaining < 0;

  if (variant === "compact") {
    return (
      <section
        aria-labelledby="budget-summary-heading-compact"
        className="mt-10"
      >
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2
            id="budget-summary-heading-compact"
            className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
          >
            Budget
          </h2>
          <Link
            href={`/trips/${tripId}/budget`}
            className="text-xs underline underline-offset-2 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Open budget
          </Link>
        </div>
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Budget"
              value={
                totalBudget !== null
                  ? formatCurrency(totalBudget, tripBaseCurrency)
                  : `Not set (${tripBaseCurrency})`
              }
            />
            <Stat label="Spent" value={formatCurrency(spent, tripBaseCurrency)} />
            {totalBudget !== null && remaining !== null && (
              <Stat
                label={overBudget ? "Over by" : "Remaining"}
                value={formatCurrency(
                  Math.abs(remaining),
                  tripBaseCurrency,
                )}
                tone={overBudget ? "danger" : undefined}
              />
            )}
          </dl>
        </div>
      </section>
    );
  }

  // Full variant
  return (
    <div className="space-y-6">
      <section
        aria-labelledby="budget-totals-heading"
        className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
      >
        <h2
          id="budget-totals-heading"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-3"
        >
          Trip totals
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Budget"
            value={
              totalBudget !== null
                ? formatCurrency(totalBudget, tripBaseCurrency)
                : `Not set (${tripBaseCurrency})`
            }
            note={totalBudget === null ? "Set a budget on Edit trip" : undefined}
          />
          <Stat label="Spent" value={formatCurrency(spent, tripBaseCurrency)} />
          {totalBudget !== null && remaining !== null ? (
            <Stat
              label={overBudget ? "Over by" : "Remaining"}
              value={formatCurrency(Math.abs(remaining), tripBaseCurrency)}
              tone={overBudget ? "danger" : undefined}
            />
          ) : (
            <Stat label="Remaining" value="—" />
          )}
        </dl>
      </section>

      <BalancesTable
        balances={balances.balances}
        tripBaseCurrency={tripBaseCurrency}
      />
    </div>
  );
}

function BalancesTable({
  balances,
  tripBaseCurrency,
}: {
  balances: ReadonlyArray<TripBalance>;
  tripBaseCurrency: string;
}) {
  return (
    <section
      aria-labelledby="balances-heading"
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
    >
      <h2
        id="balances-heading"
        className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-3"
      >
        Member balances
      </h2>
      <p className="text-xs text-zinc-500 mb-3">
        <span className="text-emerald-700 dark:text-emerald-400 font-medium">
          Positive
        </span>{" "}
        means owed money;{" "}
        <span className="text-red-700 dark:text-red-400 font-medium">
          negative
        </span>{" "}
        means owes money.
      </p>
      {balances.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No balances yet — add an expense to see who owes what.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2 sm:mx-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-2 py-2 font-medium">Member</th>
                <th className="px-2 py-2 font-medium text-right">Paid</th>
                <th className="px-2 py-2 font-medium text-right">Owes</th>
                <th className="px-2 py-2 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {balances.map((b) => {
                const name = b.full_name?.trim() || b.email || "Unknown";
                const tone =
                  b.net > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : b.net < 0
                    ? "text-red-700 dark:text-red-400"
                    : "text-zinc-700 dark:text-zinc-300";
                return (
                  <tr key={b.user_id}>
                    <td className="px-2 py-2 text-zinc-800 dark:text-zinc-200">
                      {name}
                    </td>
                    <td className="px-2 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {formatCurrency(b.paid, tripBaseCurrency)}
                    </td>
                    <td className="px-2 py-2 text-right text-zinc-700 dark:text-zinc-300">
                      {formatCurrency(b.owes, tripBaseCurrency)}
                    </td>
                    <td
                      className={`px-2 py-2 text-right font-medium ${tone}`}
                    >
                      {formatCurrency(b.net, tripBaseCurrency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "danger";
}) {
  const valueClass =
    tone === "danger"
      ? "text-red-700 dark:text-red-400"
      : "text-zinc-900 dark:text-zinc-50";
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className={`mt-1 text-base font-semibold ${valueClass}`}>{value}</dd>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}

