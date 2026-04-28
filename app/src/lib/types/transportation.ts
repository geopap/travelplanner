// Domain types for the `transportation` table (B-007).
// Mirrors the DB row shape after migration 0008_transportation.sql.

import type { ItineraryItem } from './domain';

export type TransportMode = 'flight' | 'train' | 'bus' | 'car' | 'ferry' | 'other';

export interface Transportation {
  id: string;
  itinerary_item_id: string;
  trip_id: string;
  mode: TransportMode;
  carrier: string | null;
  confirmation: string | null;
  departure_location: string | null;
  arrival_location: string | null;
  /** ISO 8601 with offset (Postgres `timestamptz`). Null when unspecified. */
  departure_time: string | null;
  arrival_time: string | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Slim itinerary-item projection used by the list endpoint join. */
export interface TransportationItemRef {
  id: string;
  day_id: string | null;
  title: string;
}

export interface TransportationWithItem extends Transportation {
  item: TransportationItemRef;
}

/** Insert DTO matching the RPC create_transport_item p_transportation jsonb. */
export interface TransportationInsertDTO {
  mode: TransportMode;
  carrier?: string;
  confirmation?: string;
  departure_location?: string;
  arrival_location?: string;
  departure_time?: string;
  arrival_time?: string;
  cost?: number;
  currency?: string;
  notes?: string;
}

/** Patch DTO — values may be explicitly null to clear. */
export interface TransportationPatchDTO {
  mode?: TransportMode;
  carrier?: string | null;
  confirmation?: string | null;
  departure_location?: string | null;
  arrival_location?: string | null;
  departure_time?: string | null;
  arrival_time?: string | null;
  cost?: number | null;
  currency?: string | null;
  notes?: string | null;
}

/** Combined response from POST /items (transport variant). */
export interface ItemWithTransportation {
  item: ItineraryItem;
  transportation: Transportation;
}

/** Combined response from PATCH /items/[id]: transportation may be null when the new type !== 'transport'. */
export interface ItemWithMaybeTransportation {
  item: ItineraryItem;
  transportation: Transportation | null;
}
