"use client";

// B-014 — Client wrapper for the budget tab. Renders:
//   - ExpensesSummary (totals + balances) — re-mounts after mutations.
//   - "Add expense" CTA (editor/owner only).
//   - ExpensesList with filters + pagination.
//
// Members for the form/filter dropdowns are fetched server-side and passed
// in to avoid a render flicker. The list/summary re-fetch on mutation via
// `refreshKey` so totals + balances stay in sync.

import { useState } from "react";
import type { MemberRole } from "@/lib/types/domain";
import type { MemberWithProfile } from "@/lib/types/members";
import { primaryButtonClass } from "@/components/ui/FormField";
import { ExpensesList } from "./ExpensesList";
import { ExpensesSummary } from "./ExpensesSummary";
import { ExpenseForm } from "./ExpenseForm";

interface ExpensesTabClientProps {
  tripId: string;
  role: MemberRole;
  tripStartDate: string;
  tripEndDate: string;
  tripBaseCurrency: string;
  totalBudget: number | null;
  currentUserId: string;
  members: ReadonlyArray<MemberWithProfile>;
}

export function ExpensesTabClient({
  tripId,
  role,
  tripStartDate,
  tripEndDate,
  tripBaseCurrency,
  totalBudget,
  currentUserId,
  members,
}: ExpensesTabClientProps) {
  const canEdit = role === "owner" || role === "editor";
  const [creating, setCreating] = useState(false);
  // Bumped on any mutation so summary + list remount and re-fetch.
  const [refreshKey, setRefreshKey] = useState(0);

  const onChanged = () => setRefreshKey((k) => k + 1);

  return (
    <>
      {/* Summary block re-mounts on refreshKey change so totals & balances
          re-fetch after every mutation. */}
      <div className="mb-8">
        <ExpensesSummary
          key={`summary-${refreshKey}`}
          tripId={tripId}
          totalBudget={totalBudget}
          tripBaseCurrency={tripBaseCurrency}
          variant="full"
        />
      </div>

      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Expenses
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={primaryButtonClass}
          >
            Add expense
          </button>
        )}
      </div>

      <ExpensesList
        key={`list-${refreshKey}`}
        tripId={tripId}
        role={role}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        tripBaseCurrency={tripBaseCurrency}
        currentUserId={currentUserId}
        members={members}
        onAddRequested={canEdit ? () => setCreating(true) : undefined}
        onChanged={onChanged}
      />

      {creating && (
        <ExpenseForm
          mode="create"
          tripId={tripId}
          tripStartDate={tripStartDate}
          tripEndDate={tripEndDate}
          tripBaseCurrency={tripBaseCurrency}
          currentUserId={currentUserId}
          members={members}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onChanged();
          }}
        />
      )}
    </>
  );
}
