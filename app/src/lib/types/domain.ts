// Shared domain types consumed by frontend pages and components.
// Source of truth: SOLUTION_DESIGN.md §2 (schema) + docs/architecture/sprint-1-build-spec.md §3.2 (API contracts).
// These mirror the API shapes. [backend-engineer] may re-derive or re-export from Zod schemas.

export type MemberRole = "owner" | "editor" | "viewer";

export type ItineraryItemType =
  | "transport"
  | "lodging"
  | "activity"
  | "meal"
  | "note";

export interface Trip {
  id: string;
  owner_id: string;
  name: string;
  start_date: string; // ISO YYYY-MM-DD
  end_date: string; // ISO YYYY-MM-DD
  destination: string | null;
  base_currency: string; // ISO 4217
  total_budget: number | null;
  created_at: string;
  updated_at: string;
  /**
   * Caller's role on this trip when surfaced by GET /api/trips.
   * Optional to keep older payloads compatible. New code should rely on it
   * for client-side write-gating (see TripPickerDialog).
   */
  role?: MemberRole;
}

export interface TripDay {
  id: string;
  trip_id: string;
  day_number: number;
  date: string; // ISO YYYY-MM-DD
  title: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItineraryItem {
  id: string;
  trip_id: string;
  day_id: string | null;
  type: ItineraryItemType;
  title: string;
  start_time: string | null; // ISO 8601 with offset
  end_time: string | null;
  external_url: string | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Re-export transportation types for convenience.
export type {
  TransportMode,
  Transportation,
  TransportationWithItem,
  ItemWithTransportation,
  ItemWithMaybeTransportation,
} from './transportation';

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

export interface TripWithRole {
  trip: Trip;
  member: { role: MemberRole };
}

export interface DateShrinkBlockingDay {
  day_id: string;
  date: string;
  item_count: number;
}

export type InvitationStatus =
  | "pending"
  | "expired"
  | "used"
  | "revoked"
  | "invalid";

export interface Invitation {
  id: string;
  trip_id: string;
  email: string;
  role: "editor" | "viewer";
  expires_at: string; // ISO 8601
  created_by: string;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

// B-009 — Google Places shared catalog. Re-export the canonical PlaceCategory
// so callers outside `lib/google/` can type rows without a deeper import.
export type { PlaceCategory } from "@/lib/google/categories";
import type { PlaceCategory as _PlaceCategory } from "@/lib/google/categories";

export interface Place {
  id: string;
  google_place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  category: _PlaceCategory;
  cached_details: Record<string, unknown>;
  cached_at: string | null;
  created_at: string;
  updated_at: string;
}

// B-010 — Place detail types. `PlaceDetail` is the API contract for
// `GET /api/places/[googlePlaceId]`. The slim columns (name, address, lat,
// lng, category) come from the `places` row; the enriched fields are read
// from `places.cached_details` JSONB and validated via Zod on read.

export interface PhotoAttribution {
  /** Display name of the photo author. */
  name: string;
  /** Author profile/photo URI — null when missing or not http(s). */
  uri: string | null;
}

export interface PhotoRef {
  /** Google v1 photo "name" tail (after `places/{id}/photos/`). */
  photo_reference: string;
  width: number;
  height: number;
  /** Structured author attributions — rendered as JSX, never as raw HTML. */
  attributions: PhotoAttribution[];
}

export interface DayHours {
  /** 0..6, 0 = Sunday (Google convention). Bounds enforced by Zod at I/O. */
  day: number;
  /** "HH:MM" 24h, null if closed all day. */
  open: string | null;
  /** "HH:MM" 24h, null if open 24h. */
  close: string | null;
}

export interface WeeklyHours {
  /** up to 7 entries; missing day = closed. */
  periods: DayHours[];
  /** Google-localized human strings (en); display-only. */
  weekday_text: string[];
  /** Computed at read time if available — not stored. */
  open_now?: boolean;
}

export interface PlaceDetail {
  google_place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  category: _PlaceCategory;
  /** 0..5, one decimal. */
  rating: number | null;
  user_ratings_total: number | null;
  /** internationalPhoneNumber preferred. */
  phone: string | null;
  /** canonical website URI. */
  website: string | null;
  opening_hours: WeeklyHours | null;
  /** capped at 10. */
  photos: PhotoRef[];
  /** googleMapsUri. */
  google_maps_url: string | null;
  source: 'cache' | 'google';
  /** ISO 8601. */
  cached_at: string | null;
}

// B-011 — Bookmarks. `BookmarkCategory` is a strict subset of `PlaceCategory`
// (see app/src/lib/bookmarks/categories.ts for the narrowing function).
export type BookmarkCategory =
  | 'restaurant'
  | 'sight'
  | 'museum'
  | 'shopping'
  | 'other';

export interface Bookmark {
  id: string;
  trip_id: string;
  /** Null for bookmarks imported from Trello before Google Places enrichment. */
  place_id: string | null;
  category: BookmarkCategory;
  notes: string | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
  /** Optional joined slim place row — populated by GET list/detail joins. */
  place?: Pick<Place, 'name' | 'formatted_address' | 'category' | 'lat' | 'lng'>;
}

// Canonical shape for a Google Places search result row, shared by the
// server-side proxy (`lib/google/places.ts`) and the client hook
// (`lib/hooks/usePlaceSearch.ts`). Fields beyond the place id and name
// can be null when Google omits them — clients must handle nulls.
export type PlaceSearchResult = {
  google_place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  category: _PlaceCategory;
};
