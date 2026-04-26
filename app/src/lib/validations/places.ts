import { z } from 'zod';

/**
 * Strip ASCII control characters (0x00–0x1F, 0x7F) from a string.
 * Visible whitespace (space, tab) is preserved by `\u0020` etc. being out of
 * the stripped range — we only target true control codes.
 */
export function stripControlChars(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, '');
}

/**
 * `q` query parameter for `GET /api/places/search`.
 *
 * - 2..100 characters after trim.
 * - Allows letters (any script), digits, punctuation, and Unicode whitespace
 *   so multi-word multi-language queries work ("café tokyo", "東京駅").
 */
export const PlacesSearchQuery = z.object({
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[\p{L}\p{N}\p{P}\p{Zs}]+$/u, 'invalid_query'),
});

export type PlacesSearchQueryInput = z.infer<typeof PlacesSearchQuery>;

// ---------------------------------------------------------------------------
// B-010 — Place detail & photo validation.
// ---------------------------------------------------------------------------

/**
 * Google `place_id` shape — opaque token, alphanumeric + `_`/`-`.
 * Reject anything outside this character class to keep the URL path safe.
 */
export const GooglePlaceIdParam = z
  .string()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * Photo `name` field — Google v1 returns paths like
 * `places/{place_id}/photos/{photo_id}`. We accept the URL-decoded form here.
 */
export const PhotoRefParam = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9_\-/.]+$/)
  .refine((s) => !s.split('/').includes('..'), 'invalid_photo_ref');

/**
 * Allowed photo widths for the proxy. Coerces from string query param.
 */
export const PhotoMaxWidth = z.coerce
  .number()
  .int()
  .refine((v) => v === 200 || v === 400 || v === 800 || v === 1200, {
    message: 'maxWidth must be one of 200, 400, 800, 1200',
  });

export const PhotoAttributionSchema = z.object({
  name: z.string().min(1).max(256),
  uri: z.string().url().max(2048).nullable(),
});

export const PhotoRefSchema = z.object({
  photo_reference: z.string().min(1).max(512),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  attributions: z.array(PhotoAttributionSchema).max(8),
});

/**
 * Re-validation schema for the slim columns of `places` rows. Used on cache
 * read paths to guard against any unexpected shape/length drift before
 * returning data to clients.
 */
export const PlaceRowSchema = z.object({
  google_place_id: z.string().min(1).max(255),
  name: z.string().min(1).max(256),
  formatted_address: z.string().max(512).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});

export const DayHoursSchema = z.object({
  day: z.number().int().min(0).max(6),
  open: z
    .string()
    .regex(/^[0-2]\d:[0-5]\d$/)
    .nullable(),
  close: z
    .string()
    .regex(/^[0-2]\d:[0-5]\d$/)
    .nullable(),
});

export const WeeklyHoursSchema = z.object({
  periods: z.array(DayHoursSchema).max(7),
  weekday_text: z.array(z.string().max(200)).max(7),
});

/**
 * JSONB blob stored in `places.cached_details`. Strict on every displayed
 * field, but `.passthrough()` so upstream Google additions don't break reads.
 */
export const PlaceDetailCachedSchema = z
  .object({
    rating: z.number().min(0).max(5).nullable(),
    user_ratings_total: z.number().int().min(0).nullable(),
    phone: z.string().max(64).nullable(),
    website: z.string().url().max(2048).nullable(),
    opening_hours: WeeklyHoursSchema.nullable(),
    photos: z.array(PhotoRefSchema).max(10),
    google_maps_url: z.string().url().max(2048).nullable(),
  })
  .passthrough();

export type PlaceDetailCached = z.infer<typeof PlaceDetailCachedSchema>;
