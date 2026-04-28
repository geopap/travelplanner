/**
 * B-008 — Zod schemas for the accommodations API.
 *
 * Source of truth for request shapes; route handlers MUST validate input
 * via these schemas before touching the database.
 *
 * Per spec:
 * - Either `place_id` (UUID) OR `hotel_name` (1..200 chars) — at least one
 *   must be present. Both may be present (e.g. user-supplied label override
 *   for a Google-cached place).
 * - `check_out_date >= check_in_date` (same-day stays allowed; AC-2).
 * - Currency is ISO 4217 (3-letter A-Z); paired with cost — if any cost
 *   field is provided, currency MUST be provided.
 * - Confirmation ≤ 80 chars; notes ≤ 4000 chars.
 * - Costs ≥ 0; capped at 1_000_000_000 (defensive).
 */

import { z } from 'zod';
import { IsoDateSchema, Iso4217Schema, UuidSchema } from './common';

/**
 * Canonical Supabase select-string for accommodations rows + slim place join.
 * Shared by list + detail routes so the column set stays in lockstep with
 * `AccommodationRowSchema` below.
 */
export const ACCOMMODATION_SELECT =
  'id, trip_id, place_id, hotel_name, check_in_date, check_out_date, confirmation, cost_per_night, total_cost, currency, notes, created_by, created_at, updated_at, place:places(id, name, formatted_address, lat, lng)';

const HotelNameSchema = z
  .string()
  .min(1, 'hotel_name must be at least 1 character')
  .max(200, 'hotel_name must be 200 characters or fewer');

const ConfirmationSchema = z
  .string()
  .min(1, 'confirmation must be at least 1 character')
  .max(80, 'confirmation must be 80 characters or fewer');

const NotesSchema = z
  .string()
  .max(4000, 'notes must be 4000 characters or fewer');

const CostSchema = z
  .number()
  .nonnegative('cost must be ≥ 0')
  .max(1_000_000_000, 'cost is unreasonably large');

/** Reusable refinement set so PATCH can apply the same constraints. */
const refineDates = <T extends { check_in_date?: string; check_out_date?: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (d) => {
      if (!d.check_in_date || !d.check_out_date) return true;
      return d.check_out_date >= d.check_in_date;
    },
    {
      path: ['check_out_date'],
      message: 'check_out_date must be on or after check_in_date',
    },
  );

const refineNameOrPlace = <T extends { place_id?: string; hotel_name?: string }>(
  schema: z.ZodType<T>,
) =>
  schema.refine((d) => Boolean(d.place_id || d.hotel_name), {
    path: ['hotel_name'],
    message: 'Provide either hotel_name or place_id',
  });

const refineCostCurrency = <
  T extends {
    cost_per_night?: number;
    total_cost?: number;
    currency?: string;
  },
>(
  schema: z.ZodType<T>,
) =>
  schema.refine(
    (d) => {
      const hasCost = d.cost_per_night != null || d.total_cost != null;
      if (hasCost && !d.currency) return false;
      return true;
    },
    {
      path: ['currency'],
      message: 'currency is required when a cost field is provided',
    },
  );

// ----------------------------------------------------------------------------
// CREATE
// ----------------------------------------------------------------------------

const AccommodationCreateBase = z
  .object({
    place_id: UuidSchema.optional(),
    hotel_name: HotelNameSchema.optional(),
    check_in_date: IsoDateSchema,
    check_out_date: IsoDateSchema,
    confirmation: ConfirmationSchema.optional(),
    cost_per_night: CostSchema.optional(),
    total_cost: CostSchema.optional(),
    currency: Iso4217Schema.optional(),
    notes: NotesSchema.optional(),
  })
  .strict();

export const AccommodationCreate = refineCostCurrency(
  refineNameOrPlace(refineDates(AccommodationCreateBase)),
);

export type AccommodationCreateInput = z.infer<typeof AccommodationCreate>;

// ----------------------------------------------------------------------------
// PATCH — every field optional; refinements still apply when both ends present.
// `refineNameOrPlace` is gated: it only fires when the patch *explicitly*
// touches `place_id` or `hotel_name`. Patches that don't touch identity
// fields must be allowed (e.g. updating only dates or notes). The route layer
// re-validates the merged identity against the existing row.
// ----------------------------------------------------------------------------

const AccommodationPatchBase = AccommodationCreateBase.partial();

export const AccommodationPatch = refineCostCurrency(
  refineDates(AccommodationPatchBase)
    .refine(
      (d) => {
        const touchesIdentity = 'place_id' in d || 'hotel_name' in d;
        if (!touchesIdentity) return true;
        return Boolean(d.place_id || d.hotel_name);
      },
      {
        path: ['hotel_name'],
        message: 'Provide either hotel_name or place_id',
      },
    )
    .refine(
      (d) => Object.keys(d).length > 0,
      { message: 'At least one field must be provided' },
    ),
);

export type AccommodationPatchInput = z.infer<typeof AccommodationPatch>;

// ----------------------------------------------------------------------------
// LIST QUERY
// ----------------------------------------------------------------------------

export const AccommodationListQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type AccommodationListQueryInput = z.infer<typeof AccommodationListQuery>;

// ----------------------------------------------------------------------------
// Row schemas — validate Supabase responses without unsafe casts.
// ----------------------------------------------------------------------------

const PlaceJoinSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  formatted_address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

export const AccommodationRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  place_id: z.string().uuid().nullable(),
  hotel_name: z.string().nullable(),
  check_in_date: z.string(),
  check_out_date: z.string(),
  confirmation: z.string().nullable(),
  cost_per_night: z.number().nullable(),
  total_cost: z.number().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  place: z.union([PlaceJoinSchema, z.array(PlaceJoinSchema)]).nullish(),
});

export type AccommodationRow = z.infer<typeof AccommodationRowSchema>;

/** Flattens Supabase's join shape (single object or single-element array). */
export function mapAccommodationRow(row: AccommodationRow) {
  const place = Array.isArray(row.place) ? row.place[0] : row.place;
  return {
    id: row.id,
    trip_id: row.trip_id,
    place_id: row.place_id,
    hotel_name: row.hotel_name,
    check_in_date: row.check_in_date,
    check_out_date: row.check_out_date,
    confirmation: row.confirmation,
    cost_per_night: row.cost_per_night,
    total_cost: row.total_cost,
    currency: row.currency,
    notes: row.notes,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(place ? { place } : { place: null }),
  };
}

// ----------------------------------------------------------------------------
// Indicator view row
// ----------------------------------------------------------------------------

export const AccommodationIndicatorRowSchema = z.object({
  trip_id: z.string().uuid(),
  trip_day_id: z.string().uuid(),
  day_date: z.string(),
  accommodation_id: z.string().uuid(),
  hotel_name: z.string().nullable(),
  place_id: z.string().uuid().nullable(),
  indicator_type: z.enum(['check_in', 'in_stay', 'check_out', 'same_day']),
});

export type AccommodationIndicatorRow = z.infer<
  typeof AccommodationIndicatorRowSchema
>;
