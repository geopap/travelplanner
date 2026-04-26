import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SignupInput } from '@/lib/validations/auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  badRequest,
  errorResponse,
  rateLimited,
  serverError,
  validationError,
  type ApiErrorCode,
} from '@/lib/api/response';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { hashEmail } from '@/lib/utils/hash';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 10;

type InvitationStatus = 'pending' | 'expired' | 'used' | 'revoked' | 'invalid';

interface InvitationLookupRow {
  status: string;
  trip_id: string | null;
  trip_name: string | null;
  inviter_name: string | null;
  email: string | null;
  role: string | null;
  expires_at: string | null;
}

/**
 * Map an invitation lookup status to the public ApiErrorCode used in the
 * response. The shared "invite_*" namespace lets the frontend render a
 * single switch over rejection reasons.
 */
function statusToErrorCode(status: InvitationStatus): ApiErrorCode | null {
  switch (status) {
    case 'pending':
      return null;
    case 'expired':
      return 'invite_expired';
    case 'used':
      return 'invite_used';
    case 'revoked':
      return 'invite_revoked';
    case 'invalid':
      return 'invite_invalid';
  }
}

/**
 * Map a Postgres P0001 message raised by signup_consume_invitation to the
 * public ApiErrorCode. Unknown messages → invite_invalid (defensive).
 */
function rpcMessageToErrorCode(message: string): ApiErrorCode {
  switch (message) {
    case 'token_invalid':
    case 'arg_invalid':
      return 'invite_invalid';
    case 'token_expired':
      return 'invite_expired';
    case 'token_used':
      return 'invite_used';
    case 'token_revoked':
      return 'invite_revoked';
    case 'email_mismatch':
      return 'invite_email_mismatch';
    default:
      return 'invite_invalid';
  }
}

function inviteForbidden(code: ApiErrorCode): NextResponse {
  return errorResponse(code, 'Invitation cannot be used', 403);
}

/**
 * Pure detection: did GoTrue's createUser fail because the email is already
 * registered? Prefer structured fields (status 422 + code 'email_exists');
 * fall back to message regex only when neither is present. Exported-shape
 * intentionally simple so this is unit-testable.
 */
export function isDuplicateEmailError(
  err: { message?: string; status?: number; code?: string } | null | undefined,
): boolean {
  if (!err) return false;
  const code = typeof err.code === 'string' ? err.code : undefined;
  if (code === 'email_exists') return true;
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status === 422 && code !== undefined) {
    // 422 with a non-email_exists code is some other validation error.
    return false;
  }
  if (status === 422) return true;
  // Last resort: message regex (older GoTrue versions without status/code).
  const msg = typeof err.message === 'string' ? err.message : '';
  return (
    /already (registered|been registered|exists)/i.test(msg) ||
    /User already/i.test(msg)
  );
}

/**
 * Sleep helper for compensation backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(request);
    // 10/IP/15min — tightened from Sprint 1's 5 to accommodate the
    // pre-flight token check + admin createUser + RPC chain without
    // penalizing legitimate retries on transient errors.
    const rl = checkRateLimit(`signup:${ip}`, WINDOW_MS, MAX_PER_WINDOW);
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }

    const parsed = SignupInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const { email, password, invite_token } = parsed.data;
    const emailHash = hashEmail(email);

    const svc = createSupabaseServiceClient();

    // ---- Pre-flight invitation lookup (defense-in-depth) -----------------
    const lookup = await svc.rpc('get_invitation_by_token', {
      p_token: invite_token,
    });
    if (lookup.error) {
      await logAudit({
        actorId: null,
        action: 'signup_rejected',
        entity: 'auth.users',
        metadata: { reason: 'lookup_failed', email_hash: emailHash },
      });
      return serverError();
    }

    const row = Array.isArray(lookup.data)
      ? (lookup.data[0] as InvitationLookupRow | undefined)
      : undefined;
    const rawStatus = (row?.status ?? 'invalid') as string;
    const status: InvitationStatus = (
      ['pending', 'expired', 'used', 'revoked', 'invalid'] as const
    ).includes(rawStatus as InvitationStatus)
      ? (rawStatus as InvitationStatus)
      : 'invalid';

    const statusCode = statusToErrorCode(status);
    if (statusCode !== null) {
      await logAudit({
        actorId: null,
        action: 'signup_rejected',
        entity: 'trip_invitations',
        metadata: { reason: statusCode, email_hash: emailHash },
      });
      return inviteForbidden(statusCode);
    }

    // Email match (route-layer guard; RPC also enforces atomically).
    if (
      !row?.email ||
      row.email.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      await logAudit({
        actorId: null,
        action: 'signup_rejected',
        entity: 'trip_invitations',
        metadata: {
          reason: 'invite_email_mismatch',
          email_hash: emailHash,
        },
      });
      return inviteForbidden('invite_email_mismatch');
    }

    // ---- Create auth user via service role -------------------------------
    const created = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (created.error || !created.data?.user) {
      // Anti-enumeration: duplicate email returns the same 200 {ok:true}
      // shape as success. The user is NOT created and the invitation is
      // NOT consumed — a legitimate invitee whose email is already
      // registered must sign in instead.
      if (isDuplicateEmailError(created.error)) {
        await logAudit({
          actorId: null,
          action: 'signup_rejected',
          entity: 'auth.users',
          metadata: { reason: 'duplicate_email', email_hash: emailHash },
        });

        // Timing pad (HIGH-1 fix): the success path performs an extra RPC
        // round-trip + UPDATE via signup_consume_invitation. Without a pad
        // here, an attacker with a valid invitation token could measure the
        // response-time delta to enumerate registered emails. Issue the same
        // RPC with a deliberately-wrong email so the function fails fast at
        // the email_match check (raising P0001 'email_mismatch'). The result
        // is discarded — purpose is solely to match success-path latency.
        try {
          await svc.rpc('signup_consume_invitation', {
            p_token: invite_token,
            p_email: '__pad__@example.invalid',
            p_user_id: '00000000-0000-0000-0000-000000000000',
          });
        } catch {
          // Discard — pad call only.
        }

        return NextResponse.json({ ok: true }, { status: 200 });
      }

      await logAudit({
        actorId: null,
        action: 'signup_rejected',
        entity: 'auth.users',
        metadata: { reason: 'create_failed', email_hash: emailHash },
      });
      return serverError();
    }

    const newUserId = created.data.user.id;

    // ---- Atomically consume invitation -----------------------------------
    const consume = await svc.rpc('signup_consume_invitation', {
      p_token: invite_token,
      p_email: email,
      p_user_id: newUserId,
    });

    if (consume.error) {
      const code = rpcMessageToErrorCode(consume.error.message ?? '');
      // Compensate by deleting the orphan auth user with retry/backoff.
      // (HIGH-2 fix) On full failure, flag the user via app_metadata so
      // a future reconciliation job can find the orphan, and surface 503
      // to the client rather than an invite_* code that misleads the user.
      const backoffsMs = [100, 400, 1600];
      let deleted = false;
      let lastDeleteError: { message?: string } | null = null;
      for (let attempt = 0; attempt < backoffsMs.length; attempt++) {
        const del = await svc.auth.admin.deleteUser(newUserId);
        if (!del.error) {
          deleted = true;
          break;
        }
        lastDeleteError = del.error;
        if (attempt < backoffsMs.length - 1) {
          await sleep(backoffsMs[attempt + 1] ?? 0);
        }
      }

      if (!deleted) {
        await logAudit({
          actorId: null,
          action: 'signup_compensation_failed',
          entity: 'auth.users',
          entityId: newUserId,
          metadata: {
            reason: code,
            email_hash: emailHash,
            attempts: backoffsMs.length,
            last_error: lastDeleteError?.message ?? null,
          },
        });

        // Best-effort: flag the orphan in app_metadata so it can be
        // reconciled later. If THIS also fails, drop a SEV3 breadcrumb
        // so an operator can find the user_id manually.
        try {
          const flag = await svc.auth.admin.updateUserById(newUserId, {
            app_metadata: {
              signup_orphan: true,
              orphaned_at: new Date().toISOString(),
            },
          });
          if (flag.error) {
            await logAudit({
              actorId: null,
              action: 'signup_orphan_unflagged',
              entity: 'auth.users',
              entityId: newUserId,
              metadata: {
                severity: 'SEV3',
                reason: code,
                email_hash: emailHash,
                last_error: flag.error.message ?? null,
              },
            });
          }
        } catch (e) {
          await logAudit({
            actorId: null,
            action: 'signup_orphan_unflagged',
            entity: 'auth.users',
            entityId: newUserId,
            metadata: {
              severity: 'SEV3',
              reason: code,
              email_hash: emailHash,
              last_error: e instanceof Error ? e.message : 'unknown',
            },
          });
        }

        await logAudit({
          actorId: null,
          action: 'signup_rejected',
          entity: 'trip_invitations',
          metadata: { reason: code, email_hash: emailHash },
        });
        return errorResponse(
          'server_error',
          'Signup could not be completed',
          503,
        );
      }

      await logAudit({
        actorId: null,
        action: 'signup_rejected',
        entity: 'trip_invitations',
        metadata: { reason: code, email_hash: emailHash },
      });
      return inviteForbidden(code);
    }

    const consumed = Array.isArray(consume.data)
      ? (consume.data[0] as { trip_id?: string; role?: string } | undefined)
      : undefined;

    await logAudit({
      actorId: newUserId,
      action: 'signup_completed',
      entity: 'auth.users',
      entityId: newUserId,
      tripId: consumed?.trip_id ?? null,
      metadata: {
        trip_id: consumed?.trip_id ?? null,
        role: consumed?.role ?? null,
        email_hash: emailHash,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return serverError();
  }
}
