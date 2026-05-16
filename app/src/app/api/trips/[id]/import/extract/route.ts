import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { UuidSchema } from '@/lib/validations/common';
import { ExtractInput } from '@/lib/validations/import';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  rateLimited,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { checkTripAccess } from '@/lib/trip-access';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import {
  fetchSource,
  SourceFetchError,
  UnsupportedSourceError,
} from '@/lib/extract/sources';
import { extractWithRetry, LlmExtractionError } from '@/lib/extract/claude';

type RouteCtx = { params: Promise<{ id: string }> };

// 20 imports per rolling hour per user, per spike §6 + AC #8.
const IMPORT_RATE_WINDOW_MS = 60 * 60 * 1000;
const IMPORT_RATE_MAX = 20;
// Duplicate URL window — AC #12: re-import within 24h on the same trip warns.
const DUPLICATE_WINDOW_HOURS = 24;

export async function POST(
  request: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  try {
    const { id: tripId } = await ctx.params;
    if (!UuidSchema.safeParse(tripId).success) return notFound();

    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return unauthorized();
    const userId = auth.user.id;

    const access = await checkTripAccess(supabase, tripId, userId, 'editor');
    if (!access.ok) {
      return access.reason === 'forbidden' ? forbidden() : notFound();
    }

    // Rate limit BEFORE doing any work (LLM cost guard, AC #8).
    const rl = checkRateLimit(
      `import:extract:user:${userId}`,
      IMPORT_RATE_WINDOW_MS,
      IMPORT_RATE_MAX,
    );
    if (!rl.ok) {
      await logAudit({
        actorId: userId,
        action: 'import_rate_limited',
        entity: 'import_sources',
        tripId,
      });
      return rateLimited(rl.retryAfterMs);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body');
    }
    const parsed = ExtractInput.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // AC #12 — duplicate URL warning. If the same URL was imported on this trip
    // within the last 24h, refuse with a clear code rather than spending LLM
    // tokens silently. Client surfaces the warning + "view previous results".
    if (input.source_url !== undefined) {
      const cutoff = new Date(
        Date.now() - DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000,
      ).toISOString();
      const { data: existing, error: dupErr } = await supabase
        .from('import_sources')
        .select('id, created_at')
        .eq('trip_id', tripId)
        .eq('source_url', input.source_url)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dupErr) return serverError();
      if (existing) {
        return errorResponse(
          'duplicate_recent_import',
          'This URL was imported recently — view previous results?',
          409,
          { import_source_id: existing.id, created_at: existing.created_at },
        );
      }
    }

    // Fetch the source (YouTube transcript / oEmbed / generic OG / text passthrough).
    let fetched;
    try {
      fetched = await fetchSource({
        source_url: input.source_url,
        raw_text: input.raw_text,
      });
    } catch (err) {
      if (err instanceof UnsupportedSourceError) {
        return errorResponse(
          'unsupported_source',
          'This source type is not supported — paste the text instead',
          422,
        );
      }
      if (err instanceof SourceFetchError) {
        return errorResponse(
          'source_fetch_failed',
          "Couldn't read that page — paste the text instead",
          502,
        );
      }
      return serverError();
    }

    // LLM extraction with single retry on transport-level failures.
    let extracted;
    try {
      extracted = await extractWithRetry(fetched.raw_text, {
        contextLabel: input.source_url,
      });
    } catch (err) {
      await logAudit({
        actorId: userId,
        action: 'import_extract_failed',
        entity: 'import_sources',
        tripId,
        metadata: {
          source_type: fetched.source_type,
          reason: err instanceof LlmExtractionError ? err.name : 'unknown',
        },
      });
      return errorResponse('llm_unavailable', 'Extraction service unavailable', 502);
    }

    // AC #13 — zero-results guard: do NOT persist an empty import_sources row.
    if (extracted.places.length === 0 && extracted.tips.length === 0) {
      return errorResponse(
        'extraction_empty',
        'No places found — try pasting the post caption directly',
        422,
      );
    }

    // Persist the import_sources row. trip_id is taken from the URL — never the body (AC #14).
    const { data: inserted, error: insertErr } = await supabase
      .from('import_sources')
      .insert({
        trip_id: tripId,
        created_by: userId,
        source_url: input.source_url ?? null,
        source_type: fetched.source_type,
        raw_text: fetched.raw_text,
        extracted_json: extracted,
        status: 'pending',
      })
      .select('id, source_type, status, created_at, extracted_json')
      .single();
    if (insertErr || !inserted) return serverError();

    await logAudit({
      actorId: userId,
      action: 'import_extract',
      entity: 'import_sources',
      entityId: inserted.id,
      tripId,
      metadata: {
        source_type: fetched.source_type,
        place_count: extracted.places.length,
        tip_count: extracted.tips.length,
        captions_unavailable: fetched.captions_unavailable === true,
      },
    });

    return NextResponse.json(
      {
        import_source_id: inserted.id,
        source_type: fetched.source_type,
        captions_unavailable: fetched.captions_unavailable === true,
        extracted,
      },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}
