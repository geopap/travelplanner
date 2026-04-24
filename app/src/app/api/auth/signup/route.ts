import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SignupInput } from '@/lib/validations/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  rateLimited,
  serverError,
  validationError,
} from '@/lib/api/response';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_WINDOW = 5;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(request);
    // WARNING: in-memory, per-instance — Upstash in Phase B.
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

    const { email, password } = parsed.data;
    const supabase = await createSupabaseServerClient();

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteUrl}/sign-in`,
      },
    });

    // Uniform response regardless of outcome to preserve anti-enumeration
    // guarantees. Supabase already refuses to disclose duplicates; we mirror
    // that behaviour at the API layer by never branching the response shape.
    const userId = data?.user?.id ?? null;
    await logAudit({
      actorId: userId,
      action: 'signup',
      entity: 'auth.users',
      entityId: userId,
      metadata: { ok: !error },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    return serverError();
  }
}
