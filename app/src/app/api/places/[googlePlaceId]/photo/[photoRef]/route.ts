import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/supabase/server';
import {
  errorResponse,
  notFound,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import {
  GooglePlaceIdParam,
  PhotoMaxWidth,
  PhotoRefParam,
  PlaceDetailCachedSchema,
} from '@/lib/validations/places';
import { getPhoto } from '@/lib/google/places';

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_WIDTH = 800;

interface PlacePhotosRow {
  cached_details: Record<string, unknown> | null;
}

/** GET /api/places/[googlePlaceId]/photo/[photoRef]?maxWidth=N */
export async function GET(
  request: NextRequest,
  ctx: {
    params: Promise<{ googlePlaceId: string; photoRef: string }>;
  },
): Promise<Response> {
  try {
    const auth = await requireAuth();
    if (!auth) return unauthorized();
    const userId = auth.user.id;
    const supabase = auth.supabase;

    const { googlePlaceId: rawId, photoRef: rawRef } = await ctx.params;

    const idParsed = GooglePlaceIdParam.safeParse(rawId);
    if (!idParsed.success) {
      return errorResponse('invalid_place_id', 'Invalid place id', 400);
    }
    // photoRef arrives URL-encoded — decode before validating shape.
    let decodedRef: string;
    try {
      decodedRef = decodeURIComponent(rawRef);
    } catch {
      return errorResponse('validation_error', 'Invalid photo reference', 400);
    }
    const refParsed = PhotoRefParam.safeParse(decodedRef);
    if (!refParsed.success) {
      return errorResponse('validation_error', 'Invalid photo reference', 400);
    }

    const rawMaxWidth =
      new URL(request.url).searchParams.get('maxWidth') ??
      String(DEFAULT_MAX_WIDTH);
    const widthParsed = PhotoMaxWidth.safeParse(rawMaxWidth);
    if (!widthParsed.success) {
      return errorResponse('validation_error', 'Invalid maxWidth', 400);
    }
    const maxWidth = widthParsed.data;
    const googlePlaceId = idParsed.data;
    const photoRef = refParsed.data;

    // Rate limit: 60 / 60s per user.
    const rateKey = `places:photo:user:${userId}`;
    const rl = checkRateLimit(rateKey, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX);
    if (!rl.ok) {
      const retrySec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      return errorResponse(
        'rate_limit_exceeded',
        'Too many requests',
        429,
        { retry_after: retrySec },
        { 'Retry-After': String(retrySec) },
      );
    }

    // Verify the photoRef belongs to the place's cached photos. Prevents
    // using this proxy as an open Google photo proxy with arbitrary refs.
    const { data: row, error: rowErr } = await supabase
      .from('places')
      .select('cached_details')
      .eq('google_place_id', googlePlaceId)
      .maybeSingle<PlacePhotosRow>();

    if (rowErr || !row || !row.cached_details) {
      return notFound();
    }
    const cachedParsed = PlaceDetailCachedSchema.safeParse(row.cached_details);
    if (!cachedParsed.success) return notFound();
    const allowed = cachedParsed.data.photos.some(
      (p) => p.photo_reference === photoRef,
    );
    if (!allowed) return notFound();

    let upstream: { contentType: string; body: ReadableStream<Uint8Array> };
    try {
      upstream = await getPhoto(photoRef, maxWidth);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'places_photo_unavailable',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
      return errorResponse(
        'places_unavailable',
        'Places service unavailable',
        502,
      );
    }

    await logAudit({
      actorId: userId,
      action: 'place_photo_proxied',
      entity: 'places',
      entityId: googlePlaceId,
      metadata: { google_place_id: googlePlaceId, max_width: maxWidth },
    });

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.contentType,
        'Cache-Control': 'private, max-age=604800, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return serverError();
  }
}
