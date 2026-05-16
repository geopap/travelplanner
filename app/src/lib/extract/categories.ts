import type { BookmarkCategory } from '@/lib/types/domain';
import type { LlmExtractCategoryT } from '@/lib/validations/import';

/**
 * Map the LLM's category enum to the narrower `bookmarks.category` set.
 * Pure, exhaustive switch — if either enum widens, TypeScript trips the
 * `never` branch at compile time.
 */
export function llmCategoryToBookmarkCategory(
  c: LlmExtractCategoryT,
): BookmarkCategory {
  switch (c) {
    case 'restaurant':
    case 'cafe':
    case 'bar':
      return 'restaurant';
    case 'attraction':
    case 'viewpoint':
      return 'sight';
    case 'shop':
      return 'shopping';
    case 'other':
      return 'other';
    default: {
      const _exhaustive: never = c;
      void _exhaustive;
      return 'other';
    }
  }
}
