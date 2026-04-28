"use client";

// B-014 — Client hooks/wrappers for the expenses API.
// Mirrors the pattern of useAccommodations: simple state machine + apiFetch.
// `refetch` is exposed so callers can refresh after mutations.

import { useCallback, useEffect, useState } from "react";
import type {
  Expense,
  ExpenseCategory,
  ExpenseCreateDTO,
  ExpensePatchDTO,
} from "@/lib/types/expenses";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";

interface ListResponse {
  data: Expense[];
  page: number;
  limit: number;
  total: number;
  total_spent: number;
}

export interface UseExpensesOptions {
  initialPage?: number;
  limit?: number;
  category?: ExpenseCategory;
  paidBy?: string;
}

export interface UseExpensesResult {
  status: "loading" | "ready" | "error";
  items: Expense[];
  page: number;
  limit: number;
  total: number;
  totalSpent: number;
  error: string | null;
  refetch: () => Promise<void>;
  setPage: (page: number) => void;
}

export function useExpenses(
  tripId: string,
  options: UseExpensesOptions = {},
): UseExpensesResult {
  const limit = options.limit ?? 20;
  const { category, paidBy } = options;
  const [page, setPage] = useState(options.initialPage ?? 1);

  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [items, setItems] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [refetchKey, setRefetchKey] = useState(0);

  // Reset to page 1 when filters change so users don't get stuck on a
  // page that no longer exists under the new filter set.
  useEffect(() => {
    setPage(1);
  }, [category, paidBy]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function run() {
      setStatus("loading");
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", String(limit));
        if (category) params.set("category", category);
        if (paidBy) params.set("paid_by", paidBy);
        const data = await apiFetch<ListResponse>(
          `/api/trips/${encodeURIComponent(tripId)}/expenses?${params.toString()}`,
          { method: "GET", signal: controller.signal },
        );
        if (cancelled) return;
        setItems(data.data);
        setTotal(data.total);
        setTotalSpent(data.total_spent);
        setStatus("ready");
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof ApiClientError
            ? err.message
            : "Could not load expenses. Please try again.";
        setError(message);
        setStatus("error");
      }
    }
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [tripId, page, limit, category, paidBy, refetchKey]);

  const refetch = useCallback(async () => {
    setRefetchKey((k) => k + 1);
  }, []);

  return {
    status,
    items,
    page,
    limit,
    total,
    totalSpent,
    error,
    refetch,
    setPage,
  };
}

// ----------------------------------------------------------------------------
// Mutation wrappers — thin promises so callers manage their own busy state.
// Server error codes surfaced via ApiClientError.code.
// ----------------------------------------------------------------------------

interface ExpenseMutationResponse {
  expense: Expense;
}

export async function createExpense(
  tripId: string,
  body: ExpenseCreateDTO,
): Promise<Expense> {
  const res = await apiFetch<ExpenseMutationResponse>(
    `/api/trips/${encodeURIComponent(tripId)}/expenses`,
    { method: "POST", body },
  );
  return res.expense;
}

export async function updateExpense(
  tripId: string,
  expenseId: string,
  body: ExpensePatchDTO,
): Promise<Expense> {
  const res = await apiFetch<ExpenseMutationResponse>(
    `/api/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(
      expenseId,
    )}`,
    { method: "PATCH", body },
  );
  return res.expense;
}

export async function deleteExpense(
  tripId: string,
  expenseId: string,
): Promise<void> {
  await apiFetch<void>(
    `/api/trips/${encodeURIComponent(tripId)}/expenses/${encodeURIComponent(
      expenseId,
    )}`,
    { method: "DELETE" },
  );
}

export type { Expense, ExpenseCreateDTO, ExpensePatchDTO };
