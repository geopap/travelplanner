/**
 * B-021 — Zod schemas for the social-media import pipeline.
 *
 * Two routes consume these:
 *   - POST /api/trips/[id]/import/extract — extractInput, extractedPayload
 *   - POST /api/trips/[id]/import/[sourceId]/save — saveInput
 *
 * Category enum mirrors the LLM tool-call schema in SOLUTION_DESIGN.md
 * §B-021.4. It is wider than `bookmarks.category` (which is
 * BOOKMARK_CATEGORIES); the route handler narrows on save.
 */

import { z } from 'zod';
import { BOOKMARK_CATEGORIES } from '@/lib/bookmarks/categories';

/** Categories the LLM is allowed to emit. */
export const LlmExtractCategory = z.enum([
  'restaurant',
  'cafe',
  'bar',
  'attraction',
  'shop',
  'viewpoint',
  'other',
]);
export type LlmExtractCategoryT = z.infer<typeof LlmExtractCategory>;

/** Source types — mirrors the Postgres enum `import_source_type`. */
export const ImportSourceType = z.enum(['youtube', 'twitter', 'web', 'text']);
export type ImportSourceTypeT = z.infer<typeof ImportSourceType>;

/**
 * Extract input — exactly one of source_url, raw_text must be present.
 * Empty strings are not allowed; URLs must parse.
 */
export const ExtractInput = z
  .object({
    source_url: z.string().url().max(2048).optional(),
    raw_text: z.string().min(1).max(20_000).optional(),
  })
  .refine(
    (v) =>
      (v.source_url !== undefined && v.raw_text === undefined) ||
      (v.source_url === undefined && v.raw_text !== undefined),
    {
      message: 'Provide exactly one of source_url or raw_text',
      path: ['source_url'],
    },
  );
export type ExtractInputT = z.infer<typeof ExtractInput>;

/**
 * Locked structured-output payload returned by Claude `record_extraction`.
 * The route handler validates the tool-use input against this before
 * persisting to `import_sources.extracted_json`.
 */
export const ExtractedPayload = z.object({
  places: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        category: LlmExtractCategory,
        why: z.string().min(1).max(500),
      }),
    )
    .max(50),
  tips: z.array(z.string().min(1).max(500)).max(50),
});
export type ExtractedPayloadT = z.infer<typeof ExtractedPayload>;

/** Bookmark category set (narrow subset accepted on save). */
export const BookmarkCategoryEnum = z.enum(BOOKMARK_CATEGORIES);

/**
 * Save input — one entry per extracted place that the user reviewed.
 * `google_place_id` is required when `save=true` (the autocomplete must
 * have resolved a real cached place id). `save=false` skips the place.
 */
export const SaveInput = z.object({
  confirmed_places: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        google_place_id: z.string().min(1).max(255).optional(),
        category: BookmarkCategoryEnum,
        save: z.boolean(),
      }),
    )
    .max(50),
  save_tips_as_note: z.boolean(),
});
export type SaveInputT = z.infer<typeof SaveInput>;
