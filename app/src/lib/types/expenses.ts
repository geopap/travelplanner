// Domain types for the `expenses` table (B-014).
// Mirrors the DB row shape after migration 0012_expenses.sql.

export type ExpenseCategory =
  | 'accommodation'
  | 'transport'
  | 'food'
  | 'activities'
  | 'shopping'
  | 'other';

export interface ExpenseSplit {
  user_id: string;
  /** 0..100; share_pct values across an expense sum to 100 (±0.01). */
  share_pct: number;
}

/** Slim profile projection embedded in expense list/detail responses. */
export interface ExpensePaidByProfile {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface Expense {
  id: string;
  trip_id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  /** ISO 4217 — for v1, always equals trips.base_currency. */
  currency: string;
  /** ISO YYYY-MM-DD. Date-only column (no timezone). */
  occurred_at: string;
  /** Nullable: profile FK with on-delete set null. */
  paid_by: string | null;
  paid_by_profile: ExpensePaidByProfile | null;
  split_among: ExpenseSplit[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Insert DTO accepted by `POST /api/trips/[id]/expenses`. */
export interface ExpenseCreateDTO {
  category: ExpenseCategory;
  description: string;
  amount: number;
  currency: string;
  occurred_at: string;
  paid_by: string;
  split_among: ExpenseSplit[];
}

/** Patch DTO accepted by `PATCH /api/trips/[id]/expenses/[expenseId]`. */
export type ExpensePatchDTO = Partial<ExpenseCreateDTO>;

/**
 * One row of the `get_trip_balances(p_trip_id)` RPC, joined with profile
 * data for display. Sorted by `net desc` in the API response.
 */
export interface TripBalance {
  user_id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  paid: number;
  owes: number;
  net: number;
}
