import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { SigninInput } from '@/lib/validations/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  rateLimited,
  serverError,
  validationError,
} from '@/lib/api/response';
import { checkRateLimit, getClientIp, recordFailure, resetKey } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED = 5;
const IP_MAX_PER_WINDOW = 30;

function emailKey(ip: string, email: string): string {
  const hash = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  return `signin_failed:${ip}:${hash}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(request);

    // Coarse per-IP gate (fail-closed when IP unknown — conservative bucket).
    // WARNING: in-memory, per-instance — Upstash in Phase B.
    const ipRl = checkRateLimit(`signin:ip:${ip}`, WINDOW_MS, IP_MAX_PER_WINDOW);
    if (!ipRl.ok) return rateLimited(ipRl.retryAfterMs);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }

    const parsed = SigninInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const { email, password } = parsed.data;

    const key = emailKey(ip, email);
    // Rate limit: if already at/over MAX_FAILED failures in window, lock out.
    // WARNING: in-memory, per-instance — Upstash in Phase B.
    const rl = checkRateLimit(`${key}:gate`, WINDOW_MS, MAX_FAILED);
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      recordFailure(`${key}:gate`, WINDOW_MS);
      await logAudit({
        actorId: null,
        action: 'signin_failed',
        entity: 'auth.users',
      });
      // Generic message — never distinguish wrong password vs. unknown email.
      return errorResponse(
        'invalid_credentials',
        'Email or password incorrect',
        401,
      );
    }

    // Reset gate on success.
    resetKey(`${key}:gate`);

    await logAudit({
      actorId: data.user.id,
      action: 'signin',
      entity: 'auth.users',
      entityId: data.user.id,
    });

    return NextResponse.json({ user_id: data.user.id }, { status: 200 });
  } catch {
    return serverError();
  }
}
