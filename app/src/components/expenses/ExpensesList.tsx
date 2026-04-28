"use client";

// B-014 — Paginated list of expenses for a trip with filters.
// Editor/owner can edit and delete each row; viewer is read-only.
// Skeleton/empty/error states; mobile-first layout.

import { useState } from "react";
import type { MemberRole } from "@/lib/types/domain";
import type { MemberWithProfile } from "@/lib/types/members";
import type {
  Expense,
  ExpenseCategory,
  ExpensePaidByProfile,
} from "@/lib/types/expenses";
import { deleteExpense, useExpenses } from "@/lib/hooks/useExpenses";
import { ApiClientError } from "@/lib/utils/api-client";
import { formatCurrency, formatShortDate } from "@/lib/utils/format";
import { SkeletonCard } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { secondaryButtonClass, selectClass } from "@/components/ui/FormField";
import { ExpenseForm } from "./ExpenseForm";
import { RemoveExpenseDialog } from "./RemoveExpenseDialog";

interface ExpensesListProps {
  tripId: string;
  role: MemberRole;
  tripStartDate: string;
  tripEndDate: string;
  tripBaseCurrency: string;
  currentUserId: string;
  members: ReadonlyArray<MemberWithProfile>;
  /** When the parent owns the "add" CTA, set this so the inline empty-state
   *  CTA invokes it. */
  onAddRequested?: () => void;
  /** Notifies parent after a mutation that affects totals/balances. */
  onChanged?: () => void;
}

interface DeleteState {
  open: boolean;
  target?: Expense;
  busy: boolean;
  error: string | null;
}

const CATEGORY_META: Record<
  ExpenseCategory,
  { label: string; tone: string; icon: string }
> = {
  accommodation: {
    label: "Accommodation",
    tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300",
    icon: "🏨",
  },
  transport: {
    label: "Transport",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
    icon: "🚆",
  },
  food: {
    label: "Food",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    icon: "🍜",
  },
  activities: {
    label: "Activities",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    icon: "🎟",
  },
  shopping: {
    label: "Shopping",
    tone: "bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-300",
    icon: "🛍",
  },
  other: {
    label: "Other",
    tone: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
    icon: "•",
  },
};

function paidByLabel(profile: ExpensePaidByProfile | null): string {
  if (!profile) return "Removed member";
  return profile.full_name?.trim() || profile.email;
}

function initialsFor(profile: ExpensePaidByProfile | null): string {
  if (!profile) return "?";
  const source = profile.full_name?.trim() || profile.email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ExpensesList({
  tripId,
  role,
  tripStartDate,
  tripEndDate,
  tripBaseCurrency,
  currentUserId,
  members,
  onAddRequested,
  onChanged,
}: ExpensesListProps) {
  const canEdit = role === "owner" || role === "editor";

  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | "">(
    "",
  );
  const [paidByFilter, setPaidByFilter] = useState<string>("");

  const {
    status,
    items,
    page,
    limit,
    total,
    error,
    refetch,
    setPage,
  } = useExpenses(tripId, {
    limit: 20,
    category: categoryFilter || undefined,
    paidBy: paidByFilter || undefined,
  });

  const [editing, setEditing] = useState<Expense | null>(null);
  const [del, setDel] = useState<DeleteState>({
    open: false,
    busy: false,
    error: null,
  });

  async function onConfirmDelete() {
    if (!del.target) return;
    setDel((d) => ({ ...d, busy: true, error: null }));
    try {
      await deleteExpense(tripId, del.target.id);
      setDel({ open: false, busy: false, error: null });
      await refetch();
      onChanged?.();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not delete the expense. Please try again.";
      setDel((d) => ({ ...d, busy: false, error: message }));
    }
  }

  const acceptedMembers = members.filter((m) => m.status === "accepted");
  const filtersActive = categoryFilter !== "" || paidByFilter !== "";

  // Filters render above all states except the very first load skeleton so
  // the header doesn't flash.
  const filterBar = (
    <div className="mb-4 grid gap-2 sm:grid-cols-2">
      <label className="block">
        <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
          Category
        </span>
        <select
          value={categoryFilter}
          onChange={(e) =>
            setCategoryFilter(e.target.value as ExpenseCategory | "")
          }
          className={selectClass}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {(Object.keys(CATEGORY_META) as ExpenseCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">
          Paid by
        </span>
        <select
          value={paidByFilter}
          onChange={(e) => setPaidByFilter(e.target.value)}
          className={selectClass}
          aria-label="Filter by who paid"
        >
          <option value="">Anyone</option>
          {acceptedMembers.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.profile.full_name?.trim() || m.profile.email}
              {m.user_id === currentUserId ? " (you)" : ""}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  if (status === "loading" && !filtersActive && items.length === 0) {
    return (
      <>
        {filterBar}
        <div className="space-y-3" role="status" aria-live="polite">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </>
    );
  }

  if (status === "error") {
    return (
      <>
        {filterBar}
        <div
          role="alert"
          className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-4 text-sm text-red-700 dark:text-red-300 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        >
          <span>{error ?? "Could not load expenses."}</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className={secondaryButtonClass}
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        {filterBar}
        {filtersActive ? (
          <EmptyState
            icon={<EmptyIcon />}
            title="No expenses match these filters"
            message="Try clearing the category or paid-by filter to see more."
            ctaLabel="Clear filters"
            onCtaClick={() => {
              setCategoryFilter("");
              setPaidByFilter("");
            }}
          />
        ) : (
          <EmptyState
            icon={<EmptyIcon />}
            title="No expenses yet"
            message={
              canEdit
                ? "Track spending against your budget — add your first expense and split it across the trip."
                : "Once expenses are added to this trip they'll appear here."
            }
            ctaLabel={canEdit ? "Add expense" : undefined}
            onCtaClick={canEdit ? onAddRequested : undefined}
          />
        )}
      </>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      {filterBar}
      <ul className="space-y-2">
        {items.map((exp) => {
          const meta = CATEGORY_META[exp.category];
          const paidLabel = paidByLabel(exp.paid_by_profile);
          const splitCount = exp.split_among.length;
          return (
            <li
              key={exp.id}
              className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base ${meta.tone}`}
                  aria-label={meta.label}
                >
                  {meta.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.tone}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-xs text-zinc-500">
                      <time dateTime={exp.occurred_at}>
                        {formatShortDate(exp.occurred_at)}
                      </time>
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50 break-words">
                    {exp.description}
                  </p>
                  <p className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {formatCurrency(exp.amount, exp.currency)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span
                      className="inline-flex items-center gap-1.5"
                      title={`Paid by ${paidLabel}`}
                    >
                      <span
                        className="inline-flex w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 items-center justify-center text-[10px] font-semibold text-zinc-700 dark:text-zinc-200"
                        aria-hidden="true"
                      >
                        {initialsFor(exp.paid_by_profile)}
                      </span>
                      <span>
                        Paid by{" "}
                        <span className="text-zinc-700 dark:text-zinc-300">
                          {paidLabel}
                          {exp.paid_by === currentUserId ? " (you)" : ""}
                        </span>
                      </span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Split {splitCount} way{splitCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                {canEdit && (
                  <div className="shrink-0 flex flex-col sm:flex-row gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(exp)}
                      className="h-8 px-3 rounded-full border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDel({
                          open: true,
                          target: exp,
                          busy: false,
                          error: null,
                        })
                      }
                      className="h-8 px-3 rounded-full border border-red-300 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500"
        >
          <span>
            Page {page} of {totalPages} · {total}{" "}
            {total === 1 ? "expense" : "expenses"}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className={secondaryButtonClass}
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className={secondaryButtonClass}
            >
              Next
            </button>
          </div>
        </nav>
      )}

      {editing && (
        <ExpenseForm
          mode="edit"
          tripId={tripId}
          tripStartDate={tripStartDate}
          tripEndDate={tripEndDate}
          tripBaseCurrency={tripBaseCurrency}
          currentUserId={currentUserId}
          members={members}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refetch();
            onChanged?.();
          }}
        />
      )}

      <RemoveExpenseDialog
        open={del.open}
        description={del.target?.description ?? ""}
        amount={del.target?.amount ?? 0}
        currency={del.target?.currency ?? tripBaseCurrency}
        occurredAt={del.target?.occurred_at ?? ""}
        busy={del.busy}
        error={del.error}
        onConfirm={onConfirmDelete}
        onCancel={() => {
          if (del.busy) return;
          setDel({ open: false, busy: false, error: null });
        }}
      />
    </>
  );
}

function EmptyIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="w-6 h-6"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v8m-4-4h8m5 0a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
