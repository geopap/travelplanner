/**
 * B-014 — Zod schemas for the expenses API.
 *
 * Source of truth for request shapes; route handlers MUST validate input via
 * these schemas before touching the database. Cross-table checks that need a
 * DB read (`currency === trips.base_currency`, `paid_by`/`split_among` user_ids
 * are accepted trip members) live in the route layer.
 *
 * Per SOLUTION_DESIGN.md §2.11 / §4.9:
 *   - `description` 1..500 chars, required.
 *   - `amount` strictly positive, max 2 decimals.
 *   - `currency` ISO 4217 (route enforces equality with `trips.base_currency`).
 *   - `occurred_at` calendar date (YYYY-MM-DD); route+trigger enforce range.
 *   - `split_among` non-empty array of `{user_id, share_pct}` with unique
 *     user_ids and `share_pct` summing to 100 ± 0.01.
 */

import { z } from 'zod';
import { IsoDateSchema, Iso4217Schema, UuidSchema } from './common';

export const EXPENSE_CATEGORIES = [
  'accommodation',
  'transport',
  'food',
  'activities',
  'shopping',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const ExpenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

const DescriptionSchema = z
  .string()
  .min(1, 'description must be at least 1 character')
  .max(500, 'description must be 500 characters or fewer');

/**
 * Amount: positive, max 2 decimals, capped at 1e9 (defensive — well above any
 * real travel expense). The DB column is `numeric(12,2)` so anything beyond
 * 10 digits left of the decimal would fail at insert anyway.
 */
const AmountSchema = z
  .number()
  .positive('amount must be greater than 0')
  .max(1_000_000_000, 'amount is unreasonably large')
  .refine(
    (n) => {
      // Reject more than 2 decimals.
      return Math.round(n * 100) / 100 === n;
    },
    { message: 'amount may have at most 2 decimal places' },
  );

const SharePctSchema = z
  .number()
  .min(0, 'share_pct must be ≥ 0')
  .max(100, 'share_pct must be ≤ 100');

const ExpenseSplitEntry = z
  .object({
    user_id: UuidSchema,
    share_pct: SharePctSchema,
  })
  .strict();

const SplitAmongSchema = z
  .array(ExpenseSplitEntry)
  .min(1, 'split_among must contain at least one entry')
  .max(100, 'split_among has too many entries')
  .superRefine((arr, ctx) => {
    // Unique user_ids.
    const seen = new Set<string>();
    for (let i = 0; i < arr.length; i += 1) {
      const id = arr[i].user_id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'user_id'],
          message: 'user_id values in split_among must be unique',
        });
      }
      seen.add(id);
    }
    // Sum to 100 ± 0.01.
    const total = arr.reduce((acc, s) => acc + s.share_pct, 0);
    if (Math.abs(total - 100) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['share_pct'],
        message: `share_pct values must sum to 100 (got ${total.toFixed(2)})`,
      });
    }
  });

// ----------------------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------------------

const ExpenseCreateBase = z
  .object({
    category: ExpenseCategorySchema,
    description: DescriptionSchema,
    amount: AmountSchema,
    currency: Iso4217Schema,
    occurred_at: IsoDateSchema,
    paid_by: UuidSchema,
    split_among: SplitAmongSchema,
  })
  .strict();

export const ExpenseCreate = ExpenseCreateBase;
export type ExpenseCreateInput = z.infer<typeof ExpenseCreate>;
// Re-export under the name requested in the build spec.
export type CreateExpenseInput = ExpenseCreateInput;

// ----------------------------------------------------------------------------
// PATCH — every field optional. The `share_pct sums to 100`, `unique user_id`,
// and `non-empty array` rules still apply when `split_among` is supplied.
// ----------------------------------------------------------------------------

export const ExpensePatch = ExpenseCreateBase.partial().refine(
  (d) => Object.keys(d).length > 0,
  { message: 'At least one field must be provided' },
);

export type ExpensePatchInput = z.infer<typeof ExpensePatch>;
export type UpdateExpenseInput = ExpensePatchInput;

// ----------------------------------------------------------------------------
// LIST QUERY
// ----------------------------------------------------------------------------

export const ExpenseListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    category: ExpenseCategorySchema.optional(),
    paid_by: UuidSchema.optional(),
  })
  .strict();

export type ExpenseListQueryInput = z.infer<typeof ExpenseListQuery>;

// ----------------------------------------------------------------------------
// Row schemas — validate Supabase responses without unsafe casts.
// ----------------------------------------------------------------------------

export const EXPENSE_SELECT =
  'id, trip_id, category, description, amount, currency, occurred_at, paid_by, split_among, created_by, created_at, updated_at, paid_by_profile:profiles!expenses_paid_by_fkey(id, full_name, email, avatar_url)';

const PaidByProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  email: z.string(),
  avatar_url: z.string().nullable(),
});

export const ExpenseSplitEntrySchema = ExpenseSplitEntry;

const SplitAmongRowSchema = z.array(ExpenseSplitEntry);

export const ExpenseRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  category: ExpenseCategorySchema,
  description: z.string(),
  // Supabase returns numeric as string in some configs; coerce.
  amount: z.coerce.number(),
  currency: z.string(),
  occurred_at: z.string(),
  paid_by: z.string().uuid().nullable(),
  split_among: SplitAmongRowSchema,
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  paid_by_profile: z
    .union([PaidByProfileSchema, z.array(PaidByProfileSchema)])
    .nullish(),
});

export type ExpenseRow = z.infer<typeof ExpenseRowSchema>;

/** Flattens Supabase's join shape (single object or single-element array). */
export function mapExpenseRow(row: ExpenseRow) {
  const profile = Array.isArray(row.paid_by_profile)
    ? row.paid_by_profile[0] ?? null
    : row.paid_by_profile ?? null;
  return {
    id: row.id,
    trip_id: row.trip_id,
    category: row.category,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    occurred_at: row.occurred_at,
    paid_by: row.paid_by,
    paid_by_profile: profile,
    split_among: row.split_among,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ----------------------------------------------------------------------------
// Balances RPC row schema
// ----------------------------------------------------------------------------

export const TripBalanceRowSchema = z.object({
  user_id: z.string().uuid(),
  paid: z.coerce.number(),
  owes: z.coerce.number(),
  net: z.coerce.number(),
});

export type TripBalanceRow = z.infer<typeof TripBalanceRowSchema>;

// ----------------------------------------------------------------------------
// Misc DB-row boundary schemas — used by routes to avoid unsafe `as` casts
// ----------------------------------------------------------------------------

/** Profile row shape returned by `select id, full_name, email, avatar_url`. */
export const ProfileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().nullable(),
  email: z.string(),
  avatar_url: z.string().nullable(),
});

export type ProfileRow = z.infer<typeof ProfileRowSchema>;

/** Single-column `amount` row (numeric — Postgres may return string). */
export const AmountRowSchema = z.object({
  amount: z.coerce.number(),
});

export type AmountRow = z.infer<typeof AmountRowSchema>;

/** Single-column `user_id` row from `trip_members` membership lookups. */
export const TripMemberUserIdRowSchema = z.object({
  user_id: z.string().uuid(),
});

export type TripMemberUserIdRow = z.infer<typeof TripMemberUserIdRowSchema>;
