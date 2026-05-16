/**
 * B-023 — Server-side resolver: google_place_id → internal places.id (uuid).
 *
 * Mirrors the cache-lookup pattern in
 * `app/src/app/api/trips/[id]/import/[sourceId]/save/route.ts` (B-016).
 *
 * Used by the accommodations POST/PATCH routes so the client may submit a
 * Google Places ID (returned by the autocomplete) without ever learning the
 * internal `places.id`. The cache must already contain the row — the place
 * detail endpoint (`GET /api/places/[googlePlaceId]`) is responsible for
 * warming it when the user selects from autocomplete.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type PlaceResolveResult =
  | { ok: true; placeId: string }
  | { ok: false; reason: 'not_cached' | 'lookup_error' };

interface PlaceIdRow {
  id: string;
}

/**
 * Resolve a Google Places ID to the internal UUID. Returns `not_cached` when
 * no `places` row exists for the given `google_place_id` — the caller should
 * surface this as a 400/404 so the client can warm the cache (or fall back).
 */
export async function resolveGooglePlaceId(
  // Typed loosely on purpose: createSupabaseServerClient() returns the
  // generic SupabaseClient and we only use one method.
  supabase: SupabaseClient,
  googlePlaceId: string,
): Promise<PlaceResolveResult> {
  const { data, error } = await supabase
    .from('places')
    .select('id')
    .eq('google_place_id', googlePlaceId)
    .maybeSingle<PlaceIdRow>();
  if (error) return { ok: false, reason: 'lookup_error' };
  if (!data) return { ok: false, reason: 'not_cached' };
  return { ok: true, placeId: data.id };
}
