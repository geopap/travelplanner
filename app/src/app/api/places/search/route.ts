import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/supabase/server';
import {
  errorResponse,
  serverError,
  unauthorized,
} from '@/lib/api/response';
import { checkRateLimit } from '@/lib/rate-limit';
import { logAudit } from '@/lib/audit';
import {
  PlacesSearchQuery,
  stripControlChars,
} from '@/lib/validations/places';
import { searchPlaces, type PlaceSearchResult } from '@/lib/google/places';
import type { PlaceCategory } from '@/lib/google/categories';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_LIMIT = 10;

/**
 * Escape Postgres ILIKE wildcard meta-characters in a user-supplied query so
 * `%foo%` never lets a stray `%` or `_` widen the match.
 */
function escapeIlike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

interface PlaceCacheRow {
  google_place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  category: PlaceCategory;
}

/** GET /api/places/search?q=... — proxy to Google Places textSearch. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAuth();
    if (!auth) return unauthorized();
    const userId = auth.user.id;
    const supabase = auth.supabase;

    // Strip control characters before validation; Zod regex then enforces
    // the allowed Unicode classes.
    const rawQ = new URL(request.url).searchParams.get('q') ?? '';
    const cleaned = stripControlChars(rawQ);

    const parsed = PlacesSearchQuery.safeParse({ q: cleaned });
    if (!parsed.success) {
      return errorResponse('invalid_query', 'Invalid query', 400);
    }
    const { q } = parsed.data;

    // Per-user rate limit: 30 / 60s.
    const rateKey = `places:search:user:${userId}`;
    const rl = checkRateLimit(rateKey, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX);
    if (!rl.ok) {
      const retrySec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
      await logAudit({
        actorId: userId,
        action: 'places_rate_limited',
        entity: 'places',
        metadata: { retry_after: retrySec },
      });
      return errorResponse(
        'rate_limit_exceeded',
        'Too many requests',
        429,
        { retry_after: retrySec },
        { 'Retry-After': String(retrySec) },
      );
    }

    // AC #3 — cache-first read. RLS allows authenticated SELECT on `places`
    // (see 0004_places.sql). Bound by 7-day TTL and small row limit.
    const cacheCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const { data: cachedRows, error: cacheErr } = await supabase
      .from('places')
      .select('google_place_id,name,formatted_address,lat,lng,category')
      .ilike('name', `%${escapeIlike(q)}%`)
      .gte('cached_at', cacheCutoff)
      .limit(CACHE_LIMIT)
      .returns<PlaceCacheRow[]>();

    if (!cacheErr && cachedRows && cachedRows.length > 0) {
      const cached: PlaceSearchResult[] = cachedRows.map((r) => ({
        google_place_id: r.google_place_id,
        name: r.name,
        formatted_address: r.formatted_address,
        lat: r.lat,
        lng: r.lng,
        category: r.category,
      }));
      await logAudit({
        actorId: userId,
        action: 'places_search_cache_hit',
        entity: 'places',
        metadata: {
          query_length: q.length,
          result_count: cached.length,
        },
      });
      return NextResponse.json({ results: cached, source: 'cache' });
    }

    let results: PlaceSearchResult[];
    try {
      results = await searchPlaces(q);
    } catch (err) {
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

    await logAudit({
      actorId: userId,
      action: 'places_searched',
      entity: 'places',
      metadata: {
        query_length: q.length,
        result_count: results.length,
      },
    });

    return NextResponse.json({ results, source: 'google' });
  } catch {
    return serverError();
  }
}
