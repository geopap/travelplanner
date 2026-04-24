import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { UuidSchema } from '@/lib/validations/common';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import type { TripDay } from '@/lib/types/domain';

type RouteCtx = { params: Promise<{ id: string }> };

// trip_days is naturally bounded by the 365-day trip cap — un-paginated (D-2).
export async function GET(
  _req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    if (!UuidSchema.safeParse(id).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, id, auth.user.id, 'viewer');
    if (!access.ok) return notFound();

    const { data, error } = await supabase
      .from('trip_days')
      .select('*')
      .eq('trip_id', id)
      .order('day_number', { ascending: true });
    if (error) return serverError();

    return NextResponse.json({ items: (data ?? []) as TripDay[] });
  } catch {
    return serverError();
  }
}
