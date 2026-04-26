import 'server-only';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { mapGoogleTypesToCategory } from '@/lib/google/categories';
import type {
  DayHours,
  PhotoAttribution,
  PhotoRef,
  PlaceDetail,
  PlaceSearchResult,
  WeeklyHours,
} from '@/lib/types/domain';

export type { PlaceSearchResult } from '@/lib/types/domain';

const GOOGLE_TEXT_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,places.types';

const REQUEST_TIMEOUT_MS = 5000;
const RETRY_BACKOFF_MS = 250;
const MAX_RESULTS = 20;

/**
 * Loose shape of a Google Places v1 textSearch result. We validate every
 * field we read at runtime — no unsafe casts.
 */
interface GooglePlaceRaw {
  id?: unknown;
  displayName?: { text?: unknown } | unknown;
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown } | unknown;
  types?: unknown;
}

interface GoogleTextSearchResponse {
  places?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) if (typeof t === 'string') out.push(t);
  return out;
}

function parseRawPlace(raw: unknown): PlaceSearchResult | null {
  if (!isObject(raw)) return null;
  const r = raw as GooglePlaceRaw;

  const id = asString(r.id);
  if (!id) return null;

  let name: string | null = null;
  if (isObject(r.displayName)) {
    name = asString((r.displayName as Record<string, unknown>).text);
  }
  if (!name) return null;

  const formatted_address = asString(r.formattedAddress);

  let lat: number | null = null;
  let lng: number | null = null;
  if (isObject(r.location)) {
    const loc = r.location as Record<string, unknown>;
    lat = asFiniteNumber(loc.latitude);
    lng = asFiniteNumber(loc.longitude);
  }

  const types = asStringArray(r.types);
  const category = mapGoogleTypesToCategory(types);

  return {
    google_place_id: id,
    name,
    formatted_address,
    lat,
    lng,
    category,
  };
}

async function fetchOnce(
  query: string,
  apiKey: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(GOOGLE_TEXT_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: MAX_RESULTS,
        languageCode: 'en',
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callGoogle(query: string, apiKey: string): Promise<Response> {
  // First attempt.
  try {
    const res = await fetchOnce(query, apiKey);
    if (res.status >= 500 && res.status < 600) {
      // Retry once on 5xx.
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      return await fetchOnce(query, apiKey);
    }
    return res;
  } catch (err) {
    // Network / abort — retry once.
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    try {
      return await fetchOnce(query, apiKey);
    } catch {
      throw err instanceof Error ? err : new Error('places_network_error');
    }
  }
}

async function upsertPlaces(results: PlaceSearchResult[]): Promise<void> {
  if (results.length === 0) return;
  try {
    const svc = createSupabaseServiceClient();
    const rows = results.map((r) => ({
      google_place_id: r.google_place_id,
      name: r.name,
      formatted_address: r.formatted_address,
      lat: r.lat,
      lng: r.lng,
      category: r.category,
    }));
    const { error } = await svc
      .from('places')
      .upsert(rows, {
        onConflict: 'google_place_id',
        ignoreDuplicates: false,
      });
    if (error) {
      console.error(
        JSON.stringify({
          level: 'places_upsert_warn',
          error: error.message,
        }),
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'places_upsert_warn',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/**
 * Server-only Google Places textSearch wrapper.
 *
 * - Throws if `GOOGLE_PLACES_API_KEY` is missing.
 * - Throws on network failure / non-2xx after retry — caller maps to 502.
 * - Side effect: best-effort UPSERT into `places` (slim fields only).
 *   Upsert errors do NOT block the return value.
 */
export async function searchPlaces(
  query: string,
): Promise<PlaceSearchResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY missing');
  }

  const res = await callGoogle(query, apiKey);
  if (!res.ok) {
    throw new Error(`places_http_${res.status}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error('places_invalid_json');
  }

  const body = isObject(raw) ? (raw as GoogleTextSearchResponse) : {};
  const arr = Array.isArray(body.places) ? body.places : [];

  const results: PlaceSearchResult[] = [];
  for (const item of arr) {
    const parsed = parseRawPlace(item);
    if (parsed) results.push(parsed);
    if (results.length >= MAX_RESULTS) break;
  }

  // Fire-and-forget cache; errors do not block the response.
  void upsertPlaces(results).catch((err) => {
    console.error(
      JSON.stringify({
        level: 'places_upsert_failed',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  });

  return results;
}

// ---------------------------------------------------------------------------
// B-010 — Place details + photo proxy.
// ---------------------------------------------------------------------------

const GOOGLE_PLACE_DETAIL_BASE = 'https://places.googleapis.com/v1/places/';
const GOOGLE_PHOTO_BASE = 'https://places.googleapis.com/v1/';
const PHOTO_MAX_PER_PLACE = 10;

const DETAIL_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'types',
  'rating',
  'userRatingCount',
  'internationalPhoneNumber',
  'websiteUri',
  'googleMapsUri',
  'regularOpeningHours',
  'photos.name',
  'photos.widthPx',
  'photos.heightPx',
  'photos.authorAttributions',
].join(',');

/** Sentinel error: Google returned 404 for the place id. */
export class PlaceNotFoundError extends Error {
  constructor(googlePlaceId: string) {
    super(`place_not_found:${googlePlaceId}`);
    this.name = 'PlaceNotFoundError';
  }
}

interface GoogleAuthorAttribution {
  displayName?: unknown;
  uri?: unknown;
  photoUri?: unknown;
}

interface GooglePhotoRaw {
  name?: unknown;
  widthPx?: unknown;
  heightPx?: unknown;
  authorAttributions?: unknown;
}

interface GoogleOpeningPeriodPoint {
  day?: unknown;
  hour?: unknown;
  minute?: unknown;
}

interface GoogleOpeningPeriod {
  open?: GoogleOpeningPeriodPoint;
  close?: GoogleOpeningPeriodPoint;
}

interface GoogleRegularOpeningHours {
  periods?: unknown;
  weekdayDescriptions?: unknown;
  openNow?: unknown;
}

interface GooglePlaceDetailRaw {
  id?: unknown;
  displayName?: { text?: unknown } | unknown;
  formattedAddress?: unknown;
  location?: { latitude?: unknown; longitude?: unknown } | unknown;
  types?: unknown;
  rating?: unknown;
  userRatingCount?: unknown;
  internationalPhoneNumber?: unknown;
  websiteUri?: unknown;
  googleMapsUri?: unknown;
  regularOpeningHours?: GoogleRegularOpeningHours | unknown;
  photos?: unknown;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function asInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
    ? v
    : null;
}

function parsePhoto(raw: unknown): PhotoRef | null {
  if (!isObject(raw)) return null;
  const r = raw as GooglePhotoRaw;
  const name = asString(r.name);
  if (!name) return null;
  // Google "name" looks like `places/{id}/photos/{photoId}`. Strip the
  // `places/{id}/photos/` prefix to a stable token if present; otherwise
  // store the full path. The frontend echoes whatever we return verbatim.
  const photoReference = name;
  const width = asInt(r.widthPx);
  const height = asInt(r.heightPx);
  if (width == null || height == null) return null;

  const attributions: PhotoAttribution[] = [];
  if (Array.isArray(r.authorAttributions)) {
    for (const a of r.authorAttributions) {
      if (!isObject(a)) continue;
      const att = a as GoogleAuthorAttribution;
      const display = asString(att.displayName);
      if (!display) continue;
      const rawUri = asString(att.uri);
      let uri: string | null = null;
      if (rawUri) {
        try {
          const parsed = new URL(rawUri);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            uri = parsed.toString();
          }
        } catch {
          uri = null;
        }
      }
      attributions.push({ name: display.slice(0, 256), uri });
    }
  }
  return {
    photo_reference: photoReference,
    width,
    height,
    attributions: attributions.slice(0, 8),
  };
}

function parseOpeningHours(raw: unknown): WeeklyHours | null {
  if (!isObject(raw)) return null;
  const r = raw as GoogleRegularOpeningHours;
  const out: DayHours[] = [];
  if (Array.isArray(r.periods)) {
    for (const p of r.periods) {
      if (!isObject(p)) continue;
      const period = p as GoogleOpeningPeriod;
      const openPoint = period.open;
      if (!openPoint || !isObject(openPoint)) continue;
      const dayRaw = asInt(openPoint.day);
      if (dayRaw == null || dayRaw < 0 || dayRaw > 6) continue;
      const day = dayRaw as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      const oh = asInt(openPoint.hour);
      const om = asInt(openPoint.minute);
      const open =
        oh != null && om != null && oh >= 0 && oh < 24 && om >= 0 && om < 60
          ? `${pad2(oh)}:${pad2(om)}`
          : null;
      let close: string | null = null;
      if (period.close && isObject(period.close)) {
        const ch = asInt(period.close.hour);
        const cm = asInt(period.close.minute);
        if (
          ch != null &&
          cm != null &&
          ch >= 0 &&
          ch < 24 &&
          cm >= 0 &&
          cm < 60
        ) {
          close = `${pad2(ch)}:${pad2(cm)}`;
        }
      }
      out.push({ day, open, close });
      if (out.length >= 7) break;
    }
  }
  const weekdayText: string[] = [];
  if (Array.isArray(r.weekdayDescriptions)) {
    for (const w of r.weekdayDescriptions) {
      if (typeof w === 'string') weekdayText.push(w.slice(0, 200));
      if (weekdayText.length >= 7) break;
    }
  }
  const result: WeeklyHours = {
    periods: out,
    weekday_text: weekdayText,
  };
  if (typeof r.openNow === 'boolean') result.open_now = r.openNow;
  return result;
}

function parseDetailResponse(raw: unknown): PlaceDetail | null {
  if (!isObject(raw)) return null;
  const r = raw as GooglePlaceDetailRaw;

  const id = asString(r.id);
  if (!id) return null;

  let name: string | null = null;
  if (isObject(r.displayName)) {
    name = asString((r.displayName as Record<string, unknown>).text);
  }
  if (!name) return null;

  const formatted_address = asString(r.formattedAddress);

  let lat: number | null = null;
  let lng: number | null = null;
  if (isObject(r.location)) {
    const loc = r.location as Record<string, unknown>;
    lat = asFiniteNumber(loc.latitude);
    lng = asFiniteNumber(loc.longitude);
  }

  const types = asStringArray(r.types);
  const category = mapGoogleTypesToCategory(types);

  const rating = asFiniteNumber(r.rating);
  const user_ratings_total = asInt(r.userRatingCount);
  const phone = asString(r.internationalPhoneNumber);
  const website = asString(r.websiteUri);
  const google_maps_url = asString(r.googleMapsUri);

  const opening_hours = parseOpeningHours(r.regularOpeningHours);

  const photos: PhotoRef[] = [];
  if (Array.isArray(r.photos)) {
    for (const p of r.photos) {
      const parsed = parsePhoto(p);
      if (parsed) photos.push(parsed);
      if (photos.length >= PHOTO_MAX_PER_PLACE) break;
    }
  }

  return {
    google_place_id: id,
    name,
    formatted_address,
    lat,
    lng,
    category,
    rating,
    user_ratings_total,
    phone,
    website,
    opening_hours,
    photos,
    google_maps_url,
    source: 'google',
    cached_at: null,
  };
}

async function fetchDetailOnce(
  googlePlaceId: string,
  apiKey: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${GOOGLE_PLACE_DETAIL_BASE}${encodeURIComponent(googlePlaceId)}?languageCode=en`;
    return await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DETAIL_FIELD_MASK,
      },
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callGoogleDetail(
  googlePlaceId: string,
  apiKey: string,
): Promise<Response> {
  try {
    const res = await fetchDetailOnce(googlePlaceId, apiKey);
    if (res.status >= 500 && res.status < 600) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      return await fetchDetailOnce(googlePlaceId, apiKey);
    }
    return res;
  } catch (err) {
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    try {
      return await fetchDetailOnce(googlePlaceId, apiKey);
    } catch {
      throw err instanceof Error ? err : new Error('places_network_error');
    }
  }
}

/**
 * Server-only Google Places v1 `places.get` wrapper.
 *
 * - Throws `PlaceNotFoundError` on Google 404 (caller maps to 404 `place_not_found`).
 * - Throws other errors on network / non-2xx after retry — caller maps to 502.
 */
export async function getPlaceDetails(
  googlePlaceId: string,
): Promise<PlaceDetail> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY missing');
  }

  const res = await callGoogleDetail(googlePlaceId, apiKey);
  if (res.status === 404) {
    throw new PlaceNotFoundError(googlePlaceId);
  }
  if (!res.ok) {
    throw new Error(`places_http_${res.status}`);
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error('places_invalid_json');
  }

  const parsed = parseDetailResponse(raw);
  if (!parsed) {
    throw new Error('places_invalid_shape');
  }
  return parsed;
}

/**
 * Server-only Google Places v1 photo media proxy.
 *
 * Returns a streaming response — caller pipes the body straight back to the
 * client without buffering. `photoRef` is the Google `name` field.
 */
export async function getPhoto(
  photoRef: string,
  maxWidth: number,
): Promise<{ contentType: string; body: ReadableStream<Uint8Array> }> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY missing');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Google returns the binary directly when the API key is supplied via
  // header; `redirect: 'follow'` handles any 302 to the CDN URL.
  const url = `${GOOGLE_PHOTO_BASE}${photoRef}/media?maxWidthPx=${encodeURIComponent(
    String(maxWidth),
  )}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
      },
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`places_photo_http_${res.status}`);
  }
  if (!res.body) {
    throw new Error('places_photo_empty_body');
  }
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  return { contentType, body: res.body };
}
