import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import {
  errorResponse,
  rateLimited,
  serverError,
  unauthorized,
} from '@/lib/api/response';

type RouteCtx = { params: Promise<{ token: string }> };

const ACCEPT_RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const ACCEPT_RATE_MAX = 30;

interface AcceptRow {
  trip_id: string;
  role: string;
}

/**
 * Map Postgres exception messages raised by accept_invitation() to HTTP.
 * The RPC raises with `errcode = 'P0001'` and the literal token name as the
 * message text.
 */
function mapRpcError(message: string): NextResponse | null {
  if (message.includes('token_invalid')) {
    return errorResponse('not_found', 'Invitation not found', 404);
  }
  if (message.includes('token_expired')) {
    return errorResponse('token_expired', 'This invitation has expired.', 410);
  }
  if (message.includes('token_revoked')) {
    return errorResponse('token_revoked', 'This invitation has been revoked.', 410);
  }
  if (message.includes('token_used')) {
    return errorResponse('conflict', 'Invitation already used', 409);
  }
  if (message.includes('unauthenticated')) {
    return unauthorized();
  }
  return null;
}

export async function POST(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { token } = await ctx.params;

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const rl = checkRateLimit(
      `inv-accept:${userId}`,
      ACCEPT_RATE_WINDOW_MS,
      ACCEPT_RATE_MAX,
    );
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    const { data, error } = await supabase.rpc('accept_invitation', {
      p_token: token,
    });

    if (error) {
      const mapped = mapRpcError(error.message ?? '');
      if (mapped) return mapped;
      return serverError();
    }

    const row = Array.isArray(data) ? (data[0] as AcceptRow | undefined) : undefined;
    if (!row || typeof row.trip_id !== 'string' || typeof row.role !== 'string') {
      return serverError();
    }

    await logAudit({
      actorId: userId,
      action: 'invitation_accepted',
      entity: 'trip_invitations',
      entityId: null,
      tripId: row.trip_id,
      metadata: { role: row.role },
    });

    return NextResponse.json({ trip_id: row.trip_id, role: row.role });
  } catch {
    return serverError();
  }
}

