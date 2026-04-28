import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import {
  ProfileRowSchema,
  TripBalanceRowSchema,
} from '@/lib/validations/expenses';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import type { TripBalance } from '@/lib/types/expenses';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/trips/[id]/balances
 *
 * Returns one row per accepted trip member: { user_id, full_name, email,
 * avatar_url, paid, owes, net } — sorted by `net DESC` (creditors first).
 *
 * Single RPC call to `get_trip_balances` (returns paid/owes/net per member,
 * computed in SQL — no N+1) plus a single batched `profiles` lookup
 * (`in` filter) to attach display names. Two DB round-trips total.
 */
export async function GET(
  _request: NextRequest,
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
      if (access.reason === 'forbidden') return forbidden();
      // Caller is not a member — explicit error code per spec.
      return errorResponse(
        'not_a_member',
        'You are not a member of this trip',
        403,
      );
    }

    const { data: balanceData, error: balanceErr } = await supabase.rpc(
      'get_trip_balances',
      { p_trip_id: id },
    );
    if (balanceErr) return serverError();

    const parsed = TripBalanceRowSchema.array().safeParse(balanceData ?? []);
    if (!parsed.success) return serverError();
    const rows = parsed.data;

    if (rows.length === 0) {
      return NextResponse.json({ balances: [] satisfies TripBalance[] });
    }

    // Single profile lookup for all involved user_ids.
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const { data: profileRows, error: profileErr } = await supabase
      .from('profiles')
      .select('id, full_name, email, avatar_url')
      .in('id', userIds);
    if (profileErr) return serverError();

    const profileRowsParsed = ProfileRowSchema.array().safeParse(
      profileRows ?? [],
    );
    if (!profileRowsParsed.success) return serverError();

    const profileMap = new Map<
      string,
      { full_name: string | null; email: string; avatar_url: string | null }
    >();
    for (const row of profileRowsParsed.data) {
      profileMap.set(row.id, {
        full_name: row.full_name,
        email: row.email,
        avatar_url: row.avatar_url,
      });
    }

    const balances: TripBalance[] = rows.map((r) => {
      const profile = profileMap.get(r.user_id);
      return {
        user_id: r.user_id,
        full_name: profile?.full_name ?? null,
        email: profile?.email ?? '',
        avatar_url: profile?.avatar_url ?? null,
        paid: r.paid,
        owes: r.owes,
        net: r.net,
      };
    });

    // Sort by net DESC (creditors first); stable secondary sort by full_name
    // then user_id for deterministic output.
    balances.sort((a, b) => {
      if (b.net !== a.net) return b.net - a.net;
      const an = a.full_name ?? '';
      const bn = b.full_name ?? '';
      if (an !== bn) return an.localeCompare(bn);
      return a.user_id.localeCompare(b.user_id);
    });

    return NextResponse.json({ balances });
  } catch {
    return serverError();
  }
}
