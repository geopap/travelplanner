/**
 * B-014 — Validation tests for expense schemas.
 */
import { describe, it, expect } from 'vitest';
import {
  ExpenseCreate,
  ExpensePatch,
  ExpenseListQuery,
  ExpenseRowSchema,
  TripBalanceRowSchema,
  mapExpenseRow,
} from '@/lib/validations/expenses';

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const U3 = '00000000-0000-4000-8000-000000000003';

const baseCreate = {
  category: 'food' as const,
  description: 'Sushi dinner',
  amount: 100,
  currency: 'EUR',
  occurred_at: '2026-05-02',
  paid_by: U1,
  split_among: [
    { user_id: U1, share_pct: 50 },
    { user_id: U2, share_pct: 50 },
  ],
};

describe('ExpenseCreate', () => {
  it('accepts a valid payload', () => {
    expect(ExpenseCreate.safeParse(baseCreate).success).toBe(true);
  });

  it('rejects amount = 0', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, amount: 0 }).success,
    ).toBe(false);
  });

  it('rejects negative amount', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, amount: -5 }).success,
    ).toBe(false);
  });

  it('rejects amount with > 2 decimals', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, amount: 1.234 }).success,
    ).toBe(false);
  });

  it('accepts amount with exactly 2 decimals', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, amount: 1.23 }).success,
    ).toBe(true);
  });

  it('rejects empty description', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, description: '' }).success,
    ).toBe(false);
  });

  it('rejects description > 500 chars', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        description: 'x'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('accepts description == 500 chars', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        description: 'x'.repeat(500),
      }).success,
    ).toBe(true);
  });

  it('rejects bad currency code (lowercase)', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, currency: 'eur' }).success,
    ).toBe(false);
  });

  it('rejects currency != 3 chars', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, currency: 'EU' }).success,
    ).toBe(false);
  });

  it('rejects malformed occurred_at', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, occurred_at: '2026/05/02' })
        .success,
    ).toBe(false);
  });

  it('rejects empty split_among', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, split_among: [] }).success,
    ).toBe(false);
  });

  it('rejects share_pct sum != 100 (low)', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [
          { user_id: U1, share_pct: 40 },
          { user_id: U2, share_pct: 50 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects share_pct sum != 100 (high)', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [
          { user_id: U1, share_pct: 60 },
          { user_id: U2, share_pct: 50 },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts share_pct sum within 0.01 tolerance', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [
          { user_id: U1, share_pct: 33.33 },
          { user_id: U2, share_pct: 33.33 },
          { user_id: U3, share_pct: 33.34 },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects share_pct sum off by > 0.01', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [
          { user_id: U1, share_pct: 33.33 },
          { user_id: U2, share_pct: 33.33 },
          { user_id: U3, share_pct: 33.32 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate user_ids in split_among', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [
          { user_id: U1, share_pct: 50 },
          { user_id: U1, share_pct: 50 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects share_pct < 0', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [
          { user_id: U1, share_pct: -10 },
          { user_id: U2, share_pct: 110 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects share_pct > 100', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [{ user_id: U1, share_pct: 150 }],
      }).success,
    ).toBe(false);
  });

  it('rejects unknown category', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, category: 'bogus' as never })
        .success,
    ).toBe(false);
  });

  it('rejects extra/unknown top-level fields (strict)', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, extra: 'nope' }).success,
    ).toBe(false);
  });

  it('rejects extra fields inside split entries (strict)', () => {
    expect(
      ExpenseCreate.safeParse({
        ...baseCreate,
        split_among: [
          { user_id: U1, share_pct: 50, weight: 1 },
          { user_id: U2, share_pct: 50 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects non-uuid paid_by', () => {
    expect(
      ExpenseCreate.safeParse({ ...baseCreate, paid_by: 'not-a-uuid' })
        .success,
    ).toBe(false);
  });
});

describe('ExpensePatch', () => {
  it('accepts a partial patch (description only)', () => {
    expect(ExpensePatch.safeParse({ description: 'Updated' }).success).toBe(
      true,
    );
  });

  it('accepts a partial patch (amount only)', () => {
    expect(ExpensePatch.safeParse({ amount: 50 }).success).toBe(true);
  });

  it('rejects empty patch', () => {
    expect(ExpensePatch.safeParse({}).success).toBe(false);
  });

  it('rejects negative amount in patch', () => {
    expect(ExpensePatch.safeParse({ amount: -1 }).success).toBe(false);
  });

  it('rejects share_pct sum != 100 in patch', () => {
    expect(
      ExpensePatch.safeParse({
        split_among: [
          { user_id: U1, share_pct: 30 },
          { user_id: U2, share_pct: 30 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate user_ids in patch split_among', () => {
    expect(
      ExpensePatch.safeParse({
        split_among: [
          { user_id: U1, share_pct: 50 },
          { user_id: U1, share_pct: 50 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects empty split_among in patch', () => {
    expect(ExpensePatch.safeParse({ split_among: [] }).success).toBe(false);
  });

  it('rejects extra fields in patch (strict)', () => {
    expect(
      ExpensePatch.safeParse({ description: 'x', bogus: 1 }).success,
    ).toBe(false);
  });
});

describe('ExpenseListQuery', () => {
  it('applies defaults', () => {
    const r = ExpenseListQuery.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(20);
  });

  it('coerces string query params', () => {
    const r = ExpenseListQuery.parse({ page: '2', limit: '50' });
    expect(r.page).toBe(2);
    expect(r.limit).toBe(50);
  });

  it('rejects limit > 100', () => {
    expect(ExpenseListQuery.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('rejects unknown category filter', () => {
    expect(
      ExpenseListQuery.safeParse({ category: 'bogus' }).success,
    ).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(ExpenseListQuery.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('ExpenseRowSchema + mapExpenseRow', () => {
  const row = {
    id: '00000000-0000-4000-8000-0000000000aa',
    trip_id: '00000000-0000-4000-8000-000000000010',
    category: 'food',
    description: 'Sushi',
    amount: '100.00',
    currency: 'EUR',
    occurred_at: '2026-05-02',
    paid_by: U1,
    split_among: [
      { user_id: U1, share_pct: 50 },
      { user_id: U2, share_pct: 50 },
    ],
    created_by: U1,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    paid_by_profile: {
      id: U1,
      full_name: 'Alice',
      email: 'a@example.com',
      avatar_url: null,
    },
  };

  it('parses a row and coerces numeric amount', () => {
    const parsed = ExpenseRowSchema.parse(row);
    expect(parsed.amount).toBe(100);
  });

  it('mapExpenseRow flattens an array-shape join', () => {
    const arrayShape = {
      ...row,
      paid_by_profile: [
        {
          id: U1,
          full_name: 'Alice',
          email: 'a@example.com',
          avatar_url: null,
        },
      ],
    };
    const parsed = ExpenseRowSchema.parse(arrayShape);
    const mapped = mapExpenseRow(parsed);
    expect(mapped.paid_by_profile?.id).toBe(U1);
  });

  it('mapExpenseRow handles null profile', () => {
    const noProfile = { ...row, paid_by: null, paid_by_profile: null };
    const parsed = ExpenseRowSchema.parse(noProfile);
    const mapped = mapExpenseRow(parsed);
    expect(mapped.paid_by_profile).toBeNull();
  });
});

describe('TripBalanceRowSchema', () => {
  it('coerces numeric strings to numbers', () => {
    const r = TripBalanceRowSchema.parse({
      user_id: U1,
      paid: '120.50',
      owes: '60.25',
      net: '60.25',
    });
    expect(r.paid).toBe(120.5);
    expect(r.owes).toBe(60.25);
    expect(r.net).toBe(60.25);
  });
});
