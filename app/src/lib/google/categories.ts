/**
 * Canonical PlaceCategory enum used by B-009 (search), B-010 (details),
 * and B-011 (bookmarks). The set is mirrored by the CHECK constraint on
 * `places.category` in migration 0004 and by the bookmarks CHECK constraint
 * widening planned in B-011.
 */

export type PlaceCategory =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'sight'
  | 'museum'
  | 'shopping'
  | 'hotel'
  | 'transport_hub'
  | 'park'
  | 'other';

/**
 * Priority-ordered list. The first category whose Google Places `types` set
 * intersects the input wins. Order matters: a "restaurant" that also reports
 * `point_of_interest` must map to `restaurant`, not `sight`.
 */
const PRIORITY: ReadonlyArray<{
  category: PlaceCategory;
  types: ReadonlySet<string>;
}> = [
  {
    category: 'restaurant',
    types: new Set(['restaurant', 'meal_takeaway', 'meal_delivery', 'food']),
  },
  {
    category: 'cafe',
    types: new Set(['cafe', 'bakery', 'coffee_shop']),
  },
  {
    category: 'bar',
    types: new Set(['bar', 'night_club', 'pub']),
  },
  {
    category: 'museum',
    types: new Set(['museum', 'art_gallery']),
  },
  {
    category: 'sight',
    types: new Set([
      'tourist_attraction',
      'landmark',
      'church',
      'hindu_temple',
      'mosque',
      'synagogue',
      'place_of_worship',
      'point_of_interest',
    ]),
  },
  {
    category: 'shopping',
    types: new Set([
      'shopping_mall',
      'store',
      'clothing_store',
      'department_store',
      'book_store',
      'jewelry_store',
    ]),
  },
  {
    category: 'hotel',
    types: new Set(['lodging', 'hotel', 'resort_hotel', 'bed_and_breakfast']),
  },
  {
    category: 'transport_hub',
    types: new Set([
      'airport',
      'train_station',
      'subway_station',
      'bus_station',
      'transit_station',
      'light_rail_station',
      'ferry_terminal',
    ]),
  },
  {
    category: 'park',
    types: new Set(['park', 'garden', 'national_park']),
  },
];

/**
 * Pure function. First-match wins by priority order.
 */
export function mapGoogleTypesToCategory(
  types: readonly string[],
): PlaceCategory {
  for (const entry of PRIORITY) {
    for (const t of types) {
      if (entry.types.has(t)) return entry.category;
    }
  }
  return 'other';
}
