import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { rateLimited, serverError } from '@/lib/api/response';
import type { InvitationStatus } from '@/lib/types/domain';

type RouteCtx = { params: Promise<{ token: string }> };

const LOOKUP_RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const LOOKUP_RATE_MAX = 30;
// Stricter cap when the client IP cannot be determined — all such requests
// share one bucket, so legitimate traffic must not be drowned by misconfigured
// or hostile clients lacking standard forwarding headers.
const LOOKUP_RATE_MAX_UNKNOWN_IP = 5;

const VALID_STATUSES: readonly InvitationStatus[] = [
  'pending',
  'expired',
  'used',
  'revoked',
  'invalid',
];

interface LookupRow {
  status: string;
  trip_id: string | null;
  trip_name: string | null;
  inviter_name: string | null;
  email: string | null;
  role: string | null;
  expires_at: string | null;
}

function isInvitationStatus(s: string): s is InvitationStatus {
  return (VALID_STATUSES as readonly string[]).includes(s);
}

/**
 * Public invitation lookup. Always returns 200 with `{ status, ... }` —
 * the RPC enforces anti-enumeration by returning a uniform shape and
 * stripping fields for non-pending statuses.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  // request used for IP-based rate limit below.
  try {
    const { token } = await ctx.params;

    const ip = getClientIp(request);
    const isUnknownIp = ip === 'unknown';
    const rl = checkRateLimit(
      `inv-lookup:${ip}`,
      LOOKUP_RATE_WINDOW_MS,
      isUnknownIp ? LOOKUP_RATE_MAX_UNKNOWN_IP : LOOKUP_RATE_MAX,
    );
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('get_invitation_by_token', {
      p_token: token,
    });
    if (error) return serverError();

    const row = Array.isArray(data) ? (data[0] as LookupRow | undefined) : undefined;
    const rawStatus = row?.status ?? 'invalid';
    const status: InvitationStatus = isInvitationStatus(rawStatus)
      ? rawStatus
      : 'invalid';

    if (status !== 'pending' || !row) {
      return NextResponse.json({ status });
    }

    return NextResponse.json({
      status,
      trip_name: row.trip_name,
      inviter_name: row.inviter_name,
      role: row.role,
      expires_at: row.expires_at,
      // B-019: invitee email is exposed for pending invitations only so the
      // /invite/[token] page can pre-fill the read-only email field on the
      // invitation-gated sign-up form. Same risk profile as trip_name and
      // inviter_name, both of which are already exposed for pending lookups.
      email: row.email,
    });
  } catch {
    return serverError();
  }
}
