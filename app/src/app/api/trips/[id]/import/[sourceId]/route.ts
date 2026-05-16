// B-021 — GET an import_sources row for the review screen.
//
// The frontend review screen at `/trips/[id]/import?source=<sourceId>` needs
// the persisted `extracted_json` to render the per-place review cards and
// tips list. The extract POST returns this payload inline on creation, but a
// reload of the review URL (or a "view previous results" deep-link from the
// duplicate-warning flow in AC 12) requires fetching by id.
//
// Editor-gated, defense-in-depth on top of RLS. `trip_id` is taken from the
// URL and re-verified server-side against the row (AC 14).

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { UuidSchema } from '@/lib/validations/common';
import { ExtractedPayload, ImportSourceType } from '@/lib/validations/import';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  errorResponse,
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';

type RouteCtx = { params: Promise<{ id: string; sourceId: string }> };

export async function GET(
  _request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId, sourceId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();
    if (!UuidSchema.safeParse(sourceId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();

    // Editor-gated — same as the extract/save endpoints. Viewers cannot
    // import or review imports for a trip.
    const access = await checkTripAccess(supabase, tripId, auth.user.id, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    const { data: row, error } = await supabase
      .from('import_sources')
      .select('id, trip_id, source_url, source_type, status, created_at, extracted_json')
      .eq('id', sourceId)
      .eq('trip_id', tripId)
      .maybeSingle();
    if (error) return serverError();
    if (!row) {
      return errorResponse(
        'import_source_not_found',
        'Import source not found',
        404,
      );
    }

    // Validate the persisted enums and extracted payload before handing to
    // the client. The DB has its own CHECK/enum constraints, but parsing
    // here guards against drift and keeps the client schema strict.
    const sourceType = ImportSourceType.safeParse(row.source_type);
    if (!sourceType.success) return serverError();

    const extracted = ExtractedPayload.safeParse(row.extracted_json);
    if (!extracted.success) return serverError();

    const status =
      row.status === 'pending' || row.status === 'saved' ? row.status : 'pending';

    return NextResponse.json({
      import_source_id: row.id,
      source_url: row.source_url ?? null,
      source_type: sourceType.data,
      status,
      created_at: row.created_at,
      extracted: extracted.data,
    });
  } catch {
    return serverError();
  }
}
