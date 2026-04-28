import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import {
  EXPENSE_SELECT,
  ExpenseCreate,
  ExpenseListQuery,
  ExpenseRowSchema,
  TripMemberUserIdRowSchema,
  mapExpenseRow,
} from '@/lib/validations/expenses';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { logAudit } from '@/lib/audit';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/trips/[id]/expenses
 *
 * Lists expenses for a trip the caller can view.
 * - Order: occurred_at DESC, id ASC (uses expenses_trip_occurred_idx).
 * - Pagination: page (default 1) / limit (default 20, max 100).
 * - Optional filters: `category`, `paid_by`.
 * - Single foreign-table join into `profiles` for paid_by_profile — no N+1.
 * - `total_spent` is a separate aggregate over the *unpaginated, unfiltered*
 *   trip total (matches budget vs spent semantics in AC-1/AC-6).
 */
export async function GET(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const url = new URL(request.url);
    const parsed = ExpenseListQuery.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      category: url.searchParams.get('category') ?? undefined,
      paid_by: url.searchParams.get('paid_by') ?? undefined,
    });
    if (!parsed.success) {
      return errorResponse('invalid_query', 'Invalid query', 400, {
        fieldErrors: parsed.error.flatten().fieldErrors,
      });
    }
    const { page, limit, category, paid_by } = parsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let listQuery = supabase
      .from('expenses')
      .select(EXPENSE_SELECT, { count: 'exact' })
      .eq('trip_id', id);
    if (category) listQuery = listQuery.eq('category', category);
    if (paid_by) listQuery = listQuery.eq('paid_by', paid_by);

    const { data, error, count } = await listQuery
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) return serverError();

    const rowsParsed = ExpenseRowSchema.array().safeParse(data ?? []);
    if (!rowsParsed.success) return serverError();

    // total_spent — single SQL aggregate over the entire trip (not
    // filtered by category/paid_by; it represents the trip-level spend
    // rendered next to the budget). Computed in Postgres via
    // `get_trip_expense_total(p_trip_id)` — one round-trip, no row scan.
    const { data: totalRaw, error: totalErr } = await supabase.rpc(
      'get_trip_expense_total',
      { p_trip_id: id },
    );
    if (totalErr) return serverError();

    const totalParsed = z.coerce.number().safeParse(totalRaw ?? 0);
    if (!totalParsed.success) return serverError();
    // Round to 2 decimals to guard against any float drift from RPC transport.
    const totalSpent = Math.round(totalParsed.data * 100) / 100;

    return NextResponse.json({
      data: rowsParsed.data.map(mapExpenseRow),
      page,
      limit,
      total: count ?? 0,
      total_spent: totalSpent,
    });
  } catch {
    return serverError();
  }
}

/**
 * POST /api/trips/[id]/expenses
 *
 * Creates an expense. Editor+ only. Defense-in-depth checks:
 * - Body validated via Zod (description, amount, currency, share_pct sum).
 * - `currency === trips.base_currency` (v1: multi-currency deferred).
 * - `occurred_at` pre-checked here for clean error; DB trigger is the safety
 *   net (`tg_expense_within_trip`).
 * - `paid_by` and every `split_among[].user_id` must be accepted trip members
 *   — verified in a single batched membership query.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, id, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = ExpenseCreate.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Trip lookup (currency + date range).
    const { data: tripRow, error: tripErr } = await supabase
      .from('trips')
      .select('start_date, end_date, base_currency')
      .eq('id', id)
      .maybeSingle();
    if (tripErr) return serverError();
    if (!tripRow) return notFound();

    if (input.currency !== tripRow.base_currency) {
      return errorResponse(
        'invalid_currency',
        'Expense currency must match the trip base currency',
        400,
        { trip_base_currency: tripRow.base_currency },
      );
    }

    if (
      input.occurred_at < tripRow.start_date ||
      input.occurred_at > tripRow.end_date
    ) {
      return errorResponse(
        'date_out_of_range',
        'occurred_at must fall within the trip date range',
        400,
        {
          trip_start_date: tripRow.start_date,
          trip_end_date: tripRow.end_date,
        },
      );
    }

    // Membership check — paid_by + every split_among.user_id must be an
    // accepted trip member. Single batched query; de-dupe ids first.
    const memberIds = Array.from(
      new Set<string>([input.paid_by, ...input.split_among.map((s) => s.user_id)]),
    );
    const { data: memberRows, error: memberErr } = await supabase
      .from('trip_members')
      .select('user_id')
      .eq('trip_id', id)
      .eq('status', 'accepted')
      .in('user_id', memberIds);
    if (memberErr) return serverError();

    const memberRowsParsed = TripMemberUserIdRowSchema.array().safeParse(
      memberRows ?? [],
    );
    if (!memberRowsParsed.success) return serverError();
    const acceptedSet = new Set(memberRowsParsed.data.map((r) => r.user_id));
    const missing = memberIds.filter((u) => !acceptedSet.has(u));
    if (missing.length > 0) {
      return errorResponse(
        'member_not_in_trip',
        'paid_by and split_among user_ids must be accepted trip members',
        400,
        { missing_user_ids: missing },
      );
    }

    const insertPayload = {
      trip_id: id,
      category: input.category,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      occurred_at: input.occurred_at,
      paid_by: input.paid_by,
      split_among: input.split_among,
      created_by: userId,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('expenses')
      .insert(insertPayload)
      .select(EXPENSE_SELECT)
      .single();

    if (insertErr) {
      const msg = insertErr.message ?? '';
      if (msg.includes('occurred_at_out_of_range')) {
        return errorResponse(
          'date_out_of_range',
          'occurred_at must fall within the trip date range',
          400,
        );
      }
      return serverError();
    }

    if (!inserted) return serverError();

    const insertedParsed = ExpenseRowSchema.safeParse(inserted);
    if (!insertedParsed.success) return serverError();

    await logAudit({
      actorId: userId,
      action: 'expense.create',
      entity: 'expenses',
      entityId: insertedParsed.data.id,
      tripId: id,
      metadata: {
        amount: insertedParsed.data.amount,
        currency: insertedParsed.data.currency,
        category: insertedParsed.data.category,
        occurred_at: insertedParsed.data.occurred_at,
        split_count: insertedParsed.data.split_among.length,
      },
    });

    return NextResponse.json(
      { expense: mapExpenseRow(insertedParsed.data) },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}
