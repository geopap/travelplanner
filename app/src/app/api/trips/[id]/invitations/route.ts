import { randomBytes, createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkTripAccess } from '@/lib/trip-access';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  rateLimited,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { UuidSchema, PageSchema } from '@/lib/validations/common';
import { InvitationCreate } from '@/lib/validations/invitations';
import { z } from 'zod';
import type { Invitation } from '@/lib/types/domain';

type RouteCtx = { params: Promise<{ id: string }> };

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const INVITE_RATE_MAX = 10;

function hashEmail(email: string): string {
  return createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

const InsertedInvitationSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  email: z.string(),
  role: z.string(),
  expires_at: z.string(),
  created_at: z.string(),
});

const ListQuerySchema = PageSchema.extend({
  status: z
    .enum(['pending', 'accepted', 'expired', 'revoked', 'all'])
    .default('pending'),
});

export async function POST(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'owner');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const rl = checkRateLimit(
      `inv-create:${userId}`,
      INVITE_RATE_WINDOW_MS,
      INVITE_RATE_MAX,
    );
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = InvitationCreate.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const { email, role } = parsed.data;

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();

    const { data: inserted, error } = await supabase
      .from('trip_invitations')
      .insert({
        trip_id: tripId,
        email,
        role,
        token,
        expires_at: expiresAt,
        created_by: userId,
      })
      .select('id, trip_id, email, role, expires_at, created_at')
      .single();

    if (error) {
      // Postgres unique_violation = 23505 (partial active-uniq index).
      if (error.code === '23505') {
        return conflict('An active invitation for this email already exists', {
          code: 'invitation_pending_exists',
        });
      }
      return serverError();
    }
    if (!inserted) return serverError();

    const insertedParsed = InsertedInvitationSchema.safeParse(inserted);
    if (!insertedParsed.success) return serverError();
    const insertedRow = insertedParsed.data;

    await logAudit({
      actorId: userId,
      action: 'invitation_created',
      entity: 'trip_invitations',
      entityId: insertedRow.id,
      tripId,
      metadata: { email_hash: hashEmail(email), role },
    });

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const inviteUrl = `${siteUrl.replace(/\/$/, '')}/invite/${token}`;

    return NextResponse.json(
      {
        invitation: {
          id: insertedRow.id,
          email: insertedRow.email,
          role: insertedRow.role,
          expires_at: insertedRow.expires_at,
          invite_url: inviteUrl,
        },
      },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}

export async function GET(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    const access = await checkTripAccess(supabase, tripId, auth.user.id, 'owner');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const url = new URL(request.url);
    const parsed = ListQuerySchema.safeParse({
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error);
    const { page, limit, status } = parsed.data;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Token field is intentionally excluded from the projection.
    let query = supabase
      .from('trip_invitations')
      .select(
        'id, trip_id, email, role, expires_at, created_by, accepted_by_user_id, accepted_at, revoked_at, created_at',
        { count: 'exact' },
      )
      .eq('trip_id', tripId)
      .order('created_at', { ascending: false })
      .range(from, to);

    const nowIso = new Date().toISOString();
    if (status === 'pending') {
      query = query
        .is('accepted_at', null)
        .is('revoked_at', null)
        .gt('expires_at', nowIso);
    } else if (status === 'accepted') {
      query = query.not('accepted_at', 'is', null);
    } else if (status === 'revoked') {
      query = query.not('revoked_at', 'is', null);
    } else if (status === 'expired') {
      query = query
        .is('accepted_at', null)
        .is('revoked_at', null)
        .lte('expires_at', nowIso);
    }

    const { data, error, count } = await query;
    if (error) return serverError();

    return NextResponse.json({
      items: (data ?? []) as Omit<Invitation, 'token'>[],
      page,
      limit,
      total: count ?? 0,
    });
  } catch {
    return serverError();
  }
}
