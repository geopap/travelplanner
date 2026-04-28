import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import {
  EXPENSE_SELECT,
  ExpensePatch,
  ExpenseRowSchema,
  TripMemberUserIdRowSchema,
  mapExpenseRow,
} from '@/lib/validations/expenses';
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

type RouteCtx = {
  params: Promise<{ id: string; expenseId: string }>;
};

/** GET single expense. Viewer+. */
export async function GET(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, expenseId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(expenseId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(
      supabase,
      tripId,
      auth.user.id,
      'viewer',
    );
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const { data, error } = await supabase
      .from('expenses')
      .select(EXPENSE_SELECT)
      .eq('id', expenseId)
      .eq('trip_id', tripId)
      .maybeSingle();

    if (error) return serverError();
    if (!data) return notFound();

    const parsed = ExpenseRowSchema.safeParse(data);
    if (!parsed.success) return serverError();

    return NextResponse.json({ expense: mapExpenseRow(parsed.data) });
  } catch {
    return serverError();
  }
}

/** PATCH partial update. Editor+. */
export async function PATCH(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, expenseId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(expenseId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // Verify the expense belongs to the URL's trip (defense-in-depth).
    const { data: existing, error: existingErr } = await supabase
      .from('expenses')
      .select('id, trip_id, paid_by, split_among, currency, occurred_at')
      .eq('id', expenseId)
      .maybeSingle();
    if (existingErr) return serverError();
    if (!existing || existing.trip_id !== tripId) return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = ExpensePatch.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // Trip lookup only when we need to validate currency / date range.
    const needsTripLookup =
      input.currency !== undefined || input.occurred_at !== undefined;

    if (needsTripLookup) {
      const { data: tripRow, error: tripErr } = await supabase
        .from('trips')
        .select('start_date, end_date, base_currency')
        .eq('id', tripId)
        .maybeSingle();
      if (tripErr) return serverError();
      if (!tripRow) return notFound();

      if (input.currency !== undefined && input.currency !== tripRow.base_currency) {
        return errorResponse(
          'invalid_currency',
          'Expense currency must match the trip base currency',
          400,
          { trip_base_currency: tripRow.base_currency },
        );
      }
      if (input.occurred_at !== undefined) {
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
      }
    }

    // Membership re-check when paid_by and/or split_among are touched.
    const ids = new Set<string>();
    if (input.paid_by !== undefined) ids.add(input.paid_by);
    if (input.split_among !== undefined) {
      for (const s of input.split_among) ids.add(s.user_id);
    }
    if (ids.size > 0) {
      const memberIds = Array.from(ids);
      const { data: memberRows, error: memberErr } = await supabase
        .from('trip_members')
        .select('user_id')
        .eq('trip_id', tripId)
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
    }

    // Build sparse update — only include keys actually present in the input.
    const patch: Record<string, unknown> = {};
    if (input.category !== undefined) patch.category = input.category;
    if (input.description !== undefined) patch.description = input.description;
    if (input.amount !== undefined) patch.amount = input.amount;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.occurred_at !== undefined) patch.occurred_at = input.occurred_at;
    if (input.paid_by !== undefined) patch.paid_by = input.paid_by;
    if (input.split_among !== undefined) patch.split_among = input.split_among;

    const { data: updated, error: updateErr } = await supabase
      .from('expenses')
      .update(patch)
      .eq('id', expenseId)
      .eq('trip_id', tripId)
      .select(EXPENSE_SELECT)
      .single();

    if (updateErr) {
      const msg = updateErr.message ?? '';
      if (msg.includes('occurred_at_out_of_range')) {
        return errorResponse(
          'date_out_of_range',
          'occurred_at must fall within the trip date range',
          400,
        );
      }
      return serverError();
    }

    if (!updated) return serverError();

    const updatedParsed = ExpenseRowSchema.safeParse(updated);
    if (!updatedParsed.success) return serverError();

    await logAudit({
      actorId: userId,
      action: 'expense.update',
      entity: 'expenses',
      entityId: expenseId,
      tripId,
      metadata: {
        fields: Object.keys(patch),
        amount: updatedParsed.data.amount,
        currency: updatedParsed.data.currency,
        category: updatedParsed.data.category,
        occurred_at: updatedParsed.data.occurred_at,
      },
    });

    return NextResponse.json({ expense: mapExpenseRow(updatedParsed.data) });
  } catch {
    return serverError();
  }
}

/** DELETE expense. Editor+. */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, expenseId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(expenseId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const { data: existing, error: existingErr } = await supabase
      .from('expenses')
      .select('id, trip_id, amount, currency, category, occurred_at')
      .eq('id', expenseId)
      .maybeSingle();
    if (existingErr) return serverError();
    if (!existing || existing.trip_id !== tripId) return notFound();

    const { error: deleteErr } = await supabase
      .from('expenses')
      .delete()
      .eq('id', expenseId)
      .eq('trip_id', tripId);
    if (deleteErr) return serverError();

    await logAudit({
      actorId: userId,
      action: 'expense.delete',
      entity: 'expenses',
      entityId: expenseId,
      tripId,
      metadata: {
        amount: existing.amount,
        currency: existing.currency,
        category: existing.category,
        occurred_at: existing.occurred_at,
      },
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
