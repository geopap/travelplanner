import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  getPlaceDetails,
  PlaceNotFoundError,
} from '@/lib/google/places';
import { PlaceDetailCachedSchema } from '@/lib/validations/places';

/**
 * B-026 helper — resolve a Google `place_id` to the internal `places.id` (UUID),
 * fetching from Google and upserting into the cache when missing.
 *
 * Mirrors the cache-or-fetch logic in
 * `app/src/app/api/places/[googlePlaceId]/route.ts` but returns only the
 * internal UUID so callers (relink endpoint, future writers) don't need the
 * full enriched detail. Reads via the user-scoped client (RLS-safe — `places`
 * has authenticated SELECT) and writes via the service client.
 */
export type ResolveOrFetchResult =
  | { ok: true; placeId: string }
  | { ok: false; reason: 'not_found' | 'unavailable' };

interface PlaceIdRow {
  id: string;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — matches GET route.

export async function resolveOrFetchPlace(
  supabase: SupabaseClient,
  googlePlaceId: string,
): Promise<ResolveOrFetchResult> {
  // Cache hit path — single PK read.
  const { data: existing, error: lookupErr } = await supabase
    .from('places')
    .select('id, cached_at, cached_details')
    .eq('google_place_id', googlePlaceId)
    .maybeSingle<{ id: string; cached_at: string | null; cached_details: Record<string, unknown> | null }>();

  if (lookupErr) {
    return { ok: false, reason: 'unavailable' };
  }

  if (existing) {
    // Even an un-enriched row gives us the internal UUID we need.
    return { ok: true, placeId: existing.id };
  }

  // Cache miss — fetch from Google, upsert via service role, return new UUID.
  let fresh;
  try {
    fresh = await getPlaceDetails(googlePlaceId);
  } catch (err) {
    if (err instanceof PlaceNotFoundError) {
      return { ok: false, reason: 'not_found' };
    }
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'places_unavailable',
        where: 'resolveOrFetchPlace',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
    return { ok: false, reason: 'unavailable' };
  }

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
    return { ok: false, reason: 'unavailable' };
  }

  const svc = createSupabaseServiceClient();
  const { data: upserted, error: upsertErr } = await svc
    .from('places')
    .upsert(
      {
        google_place_id: fresh.google_place_id,
        name: fresh.name,
        formatted_address: fresh.formatted_address,
        lat: fresh.lat,
        lng: fresh.lng,
        category: fresh.category,
        cached_details: blobParsed.data,
        cached_at: new Date().toISOString(),
      },
      { onConflict: 'google_place_id', ignoreDuplicates: false },
    )
    .select('id')
    .single<PlaceIdRow>();

  if (upsertErr || !upserted) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'place_upsert_warn',
        where: 'resolveOrFetchPlace',
        error: upsertErr?.message ?? 'no row',
      }),
    );
    return { ok: false, reason: 'unavailable' };
  }

  // TTL is only meaningful for the GET enrichment path; we silently rely on
  // the next GET call to refresh stale rows. Keeping `CACHE_TTL_MS` referenced
  // here documents the intent for future readers.
  void CACHE_TTL_MS;

  return { ok: true, placeId: upserted.id };
}
