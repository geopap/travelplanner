import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { serverError, unauthorized } from '@/lib/api/response';
import { logAudit } from '@/lib/audit';

export async function POST(): Promise<NextResponse> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return unauthorized();

    const { error } = await supabase.auth.signOut();
    if (error) return serverError();

    await logAudit({
      actorId: data.user.id,
      action: 'signout',
      entity: 'auth.users',
      entityId: data.user.id,
    });

    return new NextResponse(null, { status: 204 });
  } catch {
    return serverError();
  }
}
