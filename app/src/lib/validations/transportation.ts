import { z } from 'zod';
import { Iso4217Schema, IsoDateTimeSchema } from './common';

/** Transport mode enum — mirrors DB CHECK on transportation.mode. */
export const TransportMode = z.enum([
  'flight',
  'train',
  'bus',
  'car',
  'ferry',
]);
export type TransportMode = z.infer<typeof TransportMode>;

/**
 * Sub-payload for creating a transportation row alongside an itinerary
 * item with type='transport'. Datetimes MUST include offset (UTC stored
 * as timestamptz). Cost/currency are paired — both set or both null.
 */
export const TransportationCreate = z
  .object({
    mode: TransportMode,
    carrier: z.string().min(1).max(120).optional(),
    confirmation: z.string().min(1).max(80).optional(),
    departure_location: z.string().min(1).max(200).optional(),
    arrival_location: z.string().min(1).max(200).optional(),
    departure_time: IsoDateTimeSchema.optional(),
    arrival_time: IsoDateTimeSchema.optional(),
    cost: z.number().nonnegative().max(1_000_000_000).optional(),
    currency: Iso4217Schema.optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (d) =>
      !d.departure_time ||
      !d.arrival_time ||
      Date.parse(d.arrival_time) >= Date.parse(d.departure_time),
    {
      path: ['arrival_time'],
      message: 'arrival_time must be on or after departure_time',
    },
  )
  .refine((d) => (d.cost === undefined) === (d.currency === undefined), {
    path: ['currency'],
    message: 'cost and currency must be set together',
  });
export type TransportationCreate = z.infer<typeof TransportationCreate>;

/**
 * Patch variant — every field optional and explicitly nullable so callers
 * can clear an existing value (cost+currency must still be cleared together
 * — enforced at the route layer because partial keys make the refine here
 * insufficient).
 */
export const TransportationPatch = z
  .object({
    mode: TransportMode.optional(),
    carrier: z.string().min(1).max(120).nullable().optional(),
    confirmation: z.string().min(1).max(80).nullable().optional(),
    departure_location: z.string().min(1).max(200).nullable().optional(),
    arrival_location: z.string().min(1).max(200).nullable().optional(),
    departure_time: IsoDateTimeSchema.nullable().optional(),
    arrival_time: IsoDateTimeSchema.nullable().optional(),
    cost: z.number().nonnegative().max(1_000_000_000).nullable().optional(),
    currency: Iso4217Schema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (d) =>
      !d.departure_time ||
      !d.arrival_time ||
      Date.parse(d.arrival_time) >= Date.parse(d.departure_time),
    {
      path: ['arrival_time'],
      message: 'arrival_time must be on or after departure_time',
    },
  );
export type TransportationPatch = z.infer<typeof TransportationPatch>;

/* ---------------------------------------------------------------------------
 * Row schemas — validate Supabase responses without unsafe `as` casts.
 * Mirror the `transportation` table shape (migration 0008).
 * ------------------------------------------------------------------------- */

export const TransportationRowSchema = z.object({
  id: z.string().uuid(),
  itinerary_item_id: z.string().uuid(),
  trip_id: z.string().uuid(),
  mode: TransportMode,
  carrier: z.string().nullable(),
  confirmation: z.string().nullable(),
  departure_location: z.string().nullable(),
  arrival_location: z.string().nullable(),
  departure_time: z.string().nullable(),
  arrival_time: z.string().nullable(),
  cost: z.number().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type TransportationRow = z.infer<typeof TransportationRowSchema>;

/** Slim itinerary-item projection for the transportation list-join. */
export const TransportationItemRefSchema = z.object({
  id: z.string(),
  day_id: z.string().nullable(),
  title: z.string(),
});
export type TransportationItemRef = z.infer<typeof TransportationItemRefSchema>;

/** List-row schema: TransportationRow + joined `item` (single or array). */
export const TransportationListRowSchema = TransportationRowSchema.extend({
  item: z.union([
    TransportationItemRefSchema,
    z.array(TransportationItemRefSchema),
  ]),
});
export type TransportationListRow = z.infer<typeof TransportationListRowSchema>;
