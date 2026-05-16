// Domain types for the `accommodations` table (B-008).
// Mirrors the DB row shape after migration 0009_accommodations.sql.

import type { Place } from './domain';

export interface Accommodation {
  id: string;
  trip_id: string;
  place_id: string | null;
  hotel_name: string | null;
  /** ISO YYYY-MM-DD. Date-only column (no timezone). */
  check_in_date: string;
  /** ISO YYYY-MM-DD. >= check_in_date (same-day stays allowed). */
  check_out_date: string;
  confirmation: string | null;
  cost_per_night: number | null;
  total_cost: number | null;
  /** ISO 4217 — required when any cost field is present. */
  currency: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Slim place projection embedded in list/detail responses. */
export type AccommodationPlaceRef = Pick<
  Place,
  'id' | 'name' | 'formatted_address' | 'lat' | 'lng'
>;

export interface AccommodationWithPlace extends Accommodation {
  place: AccommodationPlaceRef | null;
}

/** Insert DTO accepted by `POST /api/trips/[id]/accommodations`. */
export interface AccommodationCreateDTO {
  place_id?: string;
  /**
   * B-023 — alternative to `place_id`. When set, the backend resolves it to
   * an internal `places.id` (cache-first; warms the cache on miss). Either
   * `place_id` or `google_place_id` may be supplied; not both.
   */
  google_place_id?: string;
  hotel_name?: string;
  check_in_date: string;
  check_out_date: string;
  confirmation?: string;
  cost_per_night?: number;
  total_cost?: number;
  currency?: string;
  notes?: string;
}

/**
 * Patch DTO accepted by `PATCH /api/trips/[id]/accommodations/[id]`.
 * Sibling of `AccommodationCreateDTO` with these B-023 extensions:
 * - `place_id: null` — explicit clear of an existing place link.
 * - `google_place_id?: string` — link to a new place; resolved server-side.
 */
export type AccommodationPatchDTO = Omit<
  Partial<AccommodationCreateDTO>,
  'place_id'
> & {
  place_id?: string | null;
};

export type AccommodationIndicatorType =
  | 'check_in'
  | 'in_stay'
  | 'check_out'
  | 'same_day';

/**
 * B-023 — Map-endpoint marker shape returned by
 * `GET /api/trips/[id]/days/[dayId]/map` under `accommodations[]`. Place is
 * guaranteed non-null (server filters `place_id IS NULL` rows out per AC 3).
 */
export interface AccommodationMapMarker {
  accommodation_id: string;
  hotel_name: string;
  check_in_date: string;
  check_out_date: string;
  indicator_type: AccommodationIndicatorType;
  place: { id: string; lat: number; lng: number; name: string };
}

/**
 * B-023 — Map-endpoint itinerary item shape returned by
 * `GET /api/trips/[id]/days/[dayId]/map` under `items[]`. Place may be null
 * (the existing items list keeps the same invariant); the section's plottable
 * filter drops nulls before passing to `<DayMap/>`.
 */
export interface DayMapItineraryItem {
  id: string;
  title: string;
  type: string;
  start_time: string | null;
  place: { id: string; lat: number; lng: number; name: string } | null;
}

/** Full B-023 map endpoint response. */
export interface DayMapResponse {
  items: DayMapItineraryItem[];
  accommodations: AccommodationMapMarker[];
}

export interface AccommodationDayIndicator {
  trip_id: string;
  trip_day_id: string;
  /** ISO YYYY-MM-DD; redundant with `trip_day_id` but cheap and convenient. */
  day_date: string;
  accommodation_id: string;
  /** Falls back to `places.name` when `hotel_name` is null. May still be null
   *  if both sources are missing (defensive — DB CHECK forbids this state). */
  hotel_name: string | null;
  place_id: string | null;
  indicator_type: AccommodationIndicatorType;
}
