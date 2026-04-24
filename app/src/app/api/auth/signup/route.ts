import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SignupInput } from '@/lib/validations/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  conflict,
  errorResponse,
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

    if (error) {
      // Generic response — do not leak whether an account exists.
      if (
        error.status === 400 ||
        error.status === 422 ||
        error.message.toLowerCase().includes('already')
      ) {
        return conflict(
          'Email already registered or invalid',
          { code: 'email_taken_or_invalid' },
        );
      }
      return errorResponse('server_error', 'Sign-up failed', 500);
    }

    const userId = data.user?.id ?? null;
    await logAudit({
      actorId: userId,
      action: 'signup',
      entity: 'auth.users',
      entityId: userId,
    });

    return NextResponse.json({ user_id: userId }, { status: 201 });
  } catch {
    return serverError();
  }
}
