/**
 * B-011 — Bookmark category narrowing.
 *
 * `BookmarkCategory` is a strict subset of `PlaceCategory`. This module
 * narrows a place's category down to the bookmark-relevant subset using a
 * pure, exhaustive switch. If `PlaceCategory` widens without updating this
 * function, TypeScript will fail to compile (the `never` branch traps the
 * unhandled member).
 *
 * Rationale per category is documented in SOLUTION_DESIGN.md §B-011.2.
 * Server- and client-safe (no runtime imports beyond types).
 */

import type { PlaceCategory } from '@/lib/google/categories';
import type { BookmarkCategory } from '@/lib/types/domain';

export const BOOKMARK_CATEGORIES = [
  'restaurant',
  'sight',
  'museum',
  'shopping',
  'other',
] as const satisfies readonly BookmarkCategory[];

export function narrowCategoryForBookmark(c: PlaceCategory): BookmarkCategory {
  switch (c) {
    case 'restaurant':
    case 'cafe':
    case 'bar':
      return 'restaurant';
    case 'sight':
    case 'park':
      return 'sight';
    case 'museum':
      return 'museum';
    case 'shopping':
      return 'shopping';
    case 'hotel':
    case 'transport_hub':
    case 'other':
      return 'other';
    default: {
      // Exhaustiveness guard — if PlaceCategory grows, this will fail compile.
      const _exhaustive: never = c;
      void _exhaustive;
      return 'other';
    }
  }
}
