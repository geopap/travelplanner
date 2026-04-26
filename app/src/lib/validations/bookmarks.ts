/**
 * B-011 — Zod schemas for the bookmarks API.
 *
 * Source of truth for request shapes; route handlers MUST validate input
 * via these schemas before touching the database.
 */

import { z } from 'zod';
import { BOOKMARK_CATEGORIES } from '@/lib/bookmarks/categories';

const NotesSchema = z
  .string()
  .max(500, 'Notes must be 500 characters or fewer')
  .nullable();

export const BookmarkCategorySchema = z.enum(BOOKMARK_CATEGORIES);

export const CreateBookmarkInput = z.object({
  google_place_id: z.string().min(1, 'google_place_id is required'),
  category: BookmarkCategorySchema.optional(),
  notes: z.string().max(500, 'Notes must be 500 characters or fewer').optional(),
});

export type CreateBookmarkInputT = z.infer<typeof CreateBookmarkInput>;

export const UpdateBookmarkInput = z
  .object({
    category: BookmarkCategorySchema.optional(),
    notes: NotesSchema.optional(),
  })
  .refine((v) => v.category !== undefined || v.notes !== undefined, {
    message: 'At least one of category or notes must be provided',
  });

export type UpdateBookmarkInputT = z.infer<typeof UpdateBookmarkInput>;

export const ListBookmarksQuery = z.object({
  category: BookmarkCategorySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListBookmarksQueryT = z.infer<typeof ListBookmarksQuery>;

/**
 * Runtime shape of a `bookmarks` row as returned by Supabase with the
 * optional joined slim place. Used to replace unsafe `as unknown as Bookmark[]`
 * casts in API routes and server components.
 *
 * Supabase returns joined to-one relations either as a single object or a
 * single-element array depending on schema metadata; both shapes are accepted
 * here and the helper `mapBookmarkRow` flattens them.
 */
const PlaceJoinSchema = z.object({
  name: z.string(),
  formatted_address: z.string().nullable(),
  category: z.enum([
    'restaurant',
    'cafe',
    'bar',
    'sight',
    'museum',
    'shopping',
    'hotel',
    'transport_hub',
    'park',
    'other',
  ]),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

export const BookmarkRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  place_id: z.string().uuid(),
  category: BookmarkCategorySchema,
  notes: z.string().nullable(),
  added_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  place: z
    .union([PlaceJoinSchema, z.array(PlaceJoinSchema)])
    .nullish(),
});

export type BookmarkRowT = z.infer<typeof BookmarkRowSchema>;

/**
 * Flattens Supabase's join shape to the canonical `Bookmark` domain object.
 * `place` is normalized to either a single object or undefined.
 */
export function mapBookmarkRow(row: BookmarkRowT) {
  const place = Array.isArray(row.place) ? row.place[0] : row.place;
  return {
    id: row.id,
    trip_id: row.trip_id,
    place_id: row.place_id,
    category: row.category,
    notes: row.notes,
    added_by: row.added_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(place ? { place } : {}),
  };
}
