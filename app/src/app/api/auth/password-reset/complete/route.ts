import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PasswordResetCompleteInput } from '@/lib/validations/auth';
import {
  badRequest,
  rateLimited,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;

interface AccessTokenClaims {
  sub?: string;
  aal?: string;
  amr?: Array<{ method?: string }>;
}

/** Minimal base64url-JSON decode of the JWT payload (middle segment). */
function decodeJwtPayload(token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payload] = parts;
  if (!payload) return null;
  try {
    // base64url → base64
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as AccessTokenClaims;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = PasswordResetCompleteInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const ip = getClientIp(request);
    // WARNING: in-memory, per-instance — Upstash in Phase B.
    const rl = checkRateLimit(`pwreset-complete:${ip}`, WINDOW_MS, MAX_PER_WINDOW);
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return serverError();

    // Verify the recovery access_token by creating a one-off client bound to it.
    // Do NOT persist or write cookies — this is a single request/response.
    const supabase = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${parsed.data.access_token}` },
      },
    });

    const { data: userData, error: getErr } = await supabase.auth.getUser(
      parsed.data.access_token,
    );
    if (getErr || !userData.user) return unauthorized();

    // Enforce recovery-grade token: AAL1 + AMR contains 'recovery'.
    // Without this, a regular login token could be replayed here.
    const claims = decodeJwtPayload(parsed.data.access_token);
    if (!claims) return unauthorized();
    if (claims.aal !== 'aal1') return unauthorized();
    const amr = Array.isArray(claims.amr) ? claims.amr : [];
    const hasRecovery = amr.some(
      (entry) =>
        entry !== null &&
        typeof entry === 'object' &&
        entry.method === 'recovery',
    );
    if (!hasRecovery) return unauthorized();

    const { error: updErr } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (updErr) return unauthorized();

    // Invalidate all refresh tokens for this user so stolen sessions cannot
    // outlive a password reset.
    try {
      const admin = createSupabaseServiceClient();
      await admin.auth.admin.signOut(parsed.data.access_token, 'global');
    } catch {
      // Log but do not fail the reset — the password has already been changed.
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          level: 'audit_warn',
          error: 'password_reset_global_signout_failed',
        }),
      );
    }

    await logAudit({
      actorId: userData.user.id,
      action: 'password_reset_complete',
      entity: 'auth.users',
      entityId: userData.user.id,
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return serverError();
  }
}
