import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/server';
import {
  serverError,
  unauthorized,
  validationError,
  notFound,
} from '@/lib/api/response';
import { logAudit } from '@/lib/audit';
import { UpdateProfileInput } from '@/lib/validations/profile';
import type { Profile, ProfileUpdateResult } from '@/lib/types/profile';

// Avatar bytes never traverse this API — clients upload directly to the
// `avatars` Storage bucket and PATCH only the resulting public URL here.

const PROFILE_COLUMNS = 'id, email, full_name, avatar_url, created_at, updated_at';
const PROFILE_PATCH_COLUMNS = 'id, full_name, avatar_url, updated_at';

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    if (!auth) return unauthorized();

    const { data, error } = await auth.supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', auth.user.id)
      .maybeSingle();

    if (error) return serverError();
    if (!data) return notFound();

    return NextResponse.json(data as Profile, { status: 200 });
  } catch {
    return serverError();
  }
}

export async function PATCH(req: Request): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    if (!auth) return unauthorized();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return validationError(
        new z.ZodError([
          {
            code: 'custom',
            path: [],
            message: 'Invalid JSON body',
          },
        ]),
      );
    }

    const parsed = UpdateProfileInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);

    const updates: { full_name?: string | null; avatar_url?: string | null } = {};
    const changedFields: Array<'full_name' | 'avatar_url'> = [];
    if (parsed.data.full_name !== undefined) {
      updates.full_name = parsed.data.full_name;
      changedFields.push('full_name');
    }
    if (parsed.data.avatar_url !== undefined) {
      updates.avatar_url = parsed.data.avatar_url;
      changedFields.push('avatar_url');
    }

    const { data, error } = await auth.supabase
      .from('profiles')
      .update(updates)
      .eq('id', auth.user.id)
      .select(PROFILE_PATCH_COLUMNS)
      .maybeSingle();

    if (error) return serverError();
    if (!data) return notFound();

    await logAudit({
      actorId: auth.user.id,
      action: 'profile.update',
      entity: 'profiles',
      entityId: auth.user.id,
      metadata: { fields: changedFields },
    });

    return NextResponse.json(data as ProfileUpdateResult, { status: 200 });
  } catch {
    return serverError();
  }
}
