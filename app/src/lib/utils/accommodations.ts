// B-024 — Shared accommodation helpers. Extracted from
// AccommodationsList.tsx so both list and detail-modal can share `nameFor`
// without a peer-component import.

import type { AccommodationWithPlace } from "@/lib/types/accommodations";

/**
 * Returns the best human-readable name for an accommodation:
 * the explicit hotel_name when set, else the linked place's name,
 * else a generic fallback. Trims whitespace before deciding.
 */
export function nameFor(acc: AccommodationWithPlace): string {
  if (acc.hotel_name && acc.hotel_name.trim().length > 0) return acc.hotel_name;
  if (acc.place?.name && acc.place.name.trim().length > 0) return acc.place.name;
  return "Accommodation";
}
