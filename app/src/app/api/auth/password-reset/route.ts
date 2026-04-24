import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { PasswordResetInput } from '@/lib/validations/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  rateLimited,
  serverError,
  validationError,
} from '@/lib/api/response';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 3;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = PasswordResetInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const email = parsed.data.email.toLowerCase();
    const emailHash = createHash('sha256').update(email).digest('hex').slice(0, 16);
    // WARNING: in-memory, per-instance — Upstash in Phase B.
    const rl = checkRateLimit(`pwreset:${emailHash}`, WINDOW_MS, MAX_PER_WINDOW);
    if (!rl.ok) return rateLimited(rl.retryAfterMs);

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const supabase = await createSupabaseServerClient();
    // Fire-and-respond — do NOT surface success/failure so we cannot enumerate.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/reset-password`,
    });

    if (!error) {
      await logAudit({
        actorId: null,
        action: 'password_reset_request',
        entity: 'auth.users',
      });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return serverError();
  }
}
