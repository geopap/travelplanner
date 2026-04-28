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
  hotel_name?: string;
  check_in_date: string;
  check_out_date: string;
  confirmation?: string;
  cost_per_night?: number;
  total_cost?: number;
  currency?: string;
  notes?: string;
}

/** Patch DTO accepted by `PATCH /api/trips/[id]/accommodations/[id]`. */
export type AccommodationPatchDTO = Partial<AccommodationCreateDTO>;

export type AccommodationIndicatorType =
  | 'check_in'
  | 'in_stay'
  | 'check_out'
  | 'same_day';

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
