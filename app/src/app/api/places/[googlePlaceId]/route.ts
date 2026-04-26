import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  errorResponse,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import {
  GooglePlaceIdParam,
  PlaceDetailCachedSchema,
  PlaceRowSchema,
} from '@/lib/validations/places';
import {
  getPlaceDetails,
  PlaceNotFoundError,
} from '@/lib/google/places';
import type { PlaceCategory } from '@/lib/google/categories';
import type { PlaceDetail } from '@/lib/types/domain';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PlaceRow {
  google_place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  category: PlaceCategory;
  cached_details: Record<string, unknown> | null;
  cached_at: string | null;
}

/** GET /api/places/[googlePlaceId] — cache-first place detail proxy. */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ googlePlaceId: string }> },
): Promise<NextResponse> {
  void request;
  try {
    const auth = await requireAuth();
    if (!auth) return unauthorized();
    const userId = auth.user.id;
    const supabase = auth.supabase;

    const { googlePlaceId: rawId } = await ctx.params;
    const idParsed = GooglePlaceIdParam.safeParse(rawId);
    if (!idParsed.success) {
      return errorResponse('invalid_place_id', 'Invalid place id', 400);
    }
    const googlePlaceId = idParsed.data;

    // Per-user rate limit: 30 / 60s.
    const rateKey = `places:details:user:${userId}`;
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

    // Cache lookup — single PK read by `google_place_id`.
    const { data: row, error: cacheErr } = await supabase
      .from('places')
      .select(
        'google_place_id,name,formatted_address,lat,lng,category,cached_details,cached_at',
      )
      .eq('google_place_id', googlePlaceId)
      .maybeSingle<PlaceRow>();

    const cacheCutoff = Date.now() - CACHE_TTL_MS;
    if (
      !cacheErr &&
      row &&
      row.cached_at &&
      row.cached_details &&
      Object.keys(row.cached_details).length > 0 &&
      new Date(row.cached_at).getTime() >= cacheCutoff
    ) {
      const slimParsed = PlaceRowSchema.safeParse({
        google_place_id: row.google_place_id,
        name: row.name,
        formatted_address: row.formatted_address,
        lat: row.lat,
        lng: row.lng,
      });
      const parsed = PlaceDetailCachedSchema.safeParse(row.cached_details);
      if (slimParsed.success && parsed.success) {
        const detail: PlaceDetail = {
          google_place_id: slimParsed.data.google_place_id,
          name: slimParsed.data.name,
          formatted_address: slimParsed.data.formatted_address,
          lat: slimParsed.data.lat,
          lng: slimParsed.data.lng,
          category: row.category,
          rating: parsed.data.rating,
          user_ratings_total: parsed.data.user_ratings_total,
          phone: parsed.data.phone,
          website: parsed.data.website,
          opening_hours: parsed.data.opening_hours,
          photos: parsed.data.photos,
          google_maps_url: parsed.data.google_maps_url,
          source: 'cache',
          cached_at: row.cached_at,
        };
        await logAudit({
          actorId: userId,
          action: 'place_details_fetched',
          entity: 'places',
          entityId: googlePlaceId,
          metadata: { source: 'cache', google_place_id: googlePlaceId },
        });
        return NextResponse.json(detail);
      }
      // Cache parse failure → fall through to refresh from Google.
      console.warn(
        JSON.stringify({
          level: 'place_cache_parse_warn',
          google_place_id: googlePlaceId,
        }),
      );
    }

    // Cache miss / expired / invalid → call Google.
    let fresh: PlaceDetail;
    try {
      fresh = await getPlaceDetails(googlePlaceId);
    } catch (err) {
      if (err instanceof PlaceNotFoundError) {
        return errorResponse('place_not_found', 'Place not found', 404);
      }
      console.error(
        JSON.stringify({
          level: 'places_unavailable',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
      return errorResponse(
        'places_unavailable',
        'Places service unavailable',
        502,
      );
    }

    // Validate the JSONB blob shape before persisting.
    const cachedBlob = {
      rating: fresh.rating,
      user_ratings_total: fresh.user_ratings_total,
      phone: fresh.phone,
      website: fresh.website,
      opening_hours: fresh.opening_hours,
      photos: fresh.photos,
      google_maps_url: fresh.google_maps_url,
    };
    const blobParsed = PlaceDetailCachedSchema.safeParse(cachedBlob);
    if (!blobParsed.success) {
      console.error(
        JSON.stringify({
          level: 'places_invalid_blob',
          google_place_id: googlePlaceId,
        }),
      );
      return errorResponse(
        'places_unavailable',
        'Places service unavailable',
        502,
      );
    }

    // UPSERT slim columns + cached_details + cached_at via service-role.
    const nowIso = new Date().toISOString();
    try {
      const svc = createSupabaseServiceClient();
      const { error: upsertErr } = await svc.from('places').upsert(
        {
          google_place_id: fresh.google_place_id,
          name: fresh.name,
          formatted_address: fresh.formatted_address,
          lat: fresh.lat,
          lng: fresh.lng,
          category: fresh.category,
          cached_details: blobParsed.data,
          cached_at: nowIso,
        },
        { onConflict: 'google_place_id', ignoreDuplicates: false },
      );
      if (upsertErr) {
        console.error(
          JSON.stringify({
            level: 'place_upsert_warn',
            error: upsertErr.message,
          }),
        );
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'place_upsert_warn',
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
    }

    await logAudit({
      actorId: userId,
      action: 'place_details_fetched',
      entity: 'places',
      entityId: googlePlaceId,
      metadata: { source: 'google', google_place_id: googlePlaceId },
    });

    const detail: PlaceDetail = {
      ...fresh,
      source: 'google',
      cached_at: nowIso,
    };
    return NextResponse.json(detail);
  } catch {
    return serverError();
  }
}
