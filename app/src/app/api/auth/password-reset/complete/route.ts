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

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 10;

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

    const { error: updErr } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (updErr) return unauthorized();

    await logAudit({
      actorId: userData.user.id,
      action: 'password_reset_complete',
      entity: 'auth.users',
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return serverError();
  }
}
