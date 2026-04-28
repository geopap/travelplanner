import { z } from 'zod';
import {
  IsoDateTimeSchema,
  Iso4217Schema,
  UuidSchema,
} from './common';
import { TransportationCreate, TransportationPatch } from './transportation';

export const ItineraryItemType = z.enum([
  'transport',
  'lodging',
  'activity',
  'meal',
  'note',
]);
export type ItineraryItemType = z.infer<typeof ItineraryItemType>;

/* ---------------------------------------------------------------------------
 * CREATE — discriminated union on `type`.
 *
 * - `transport` variant: requires `transportation`, forbids `cost`/`currency`
 *   on the parent (AC-10 — cost lives on the transportation row only).
 * - All other variants: forbid `transportation`; allow `cost`/`currency`.
 * ------------------------------------------------------------------------- */

const BaseCreateShape = {
  day_id: UuidSchema.nullable().optional(),
  start_time: IsoDateTimeSchema.nullable().optional(),
  end_time: IsoDateTimeSchema.nullable().optional(),
  title: z.string().min(1).max(200),
  external_url: z.string().url().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
} as const;

const NonTransportCreateBase = z
  .object({
    ...BaseCreateShape,
    cost: z.number().nonnegative().nullable().optional(),
    currency: Iso4217Schema.nullable().optional(),
    transportation: z.undefined().optional(),
  })
  .refine(
    (d) =>
      !d.start_time ||
      !d.end_time ||
      Date.parse(d.end_time) >= Date.parse(d.start_time),
    { message: 'end_time must be on or after start_time', path: ['end_time'] },
  );

const TransportCreate = z
  .object({
    ...BaseCreateShape,
    type: z.literal('transport'),
    cost: z.undefined().optional(),
    currency: z.undefined().optional(),
    transportation: TransportationCreate,
  })
  .refine(
    (d) =>
      !d.start_time ||
      !d.end_time ||
      Date.parse(d.end_time) >= Date.parse(d.start_time),
    { message: 'end_time must be on or after start_time', path: ['end_time'] },
  );

const LodgingCreate = NonTransportCreateBase.and(
  z.object({ type: z.literal('lodging') }),
);
const ActivityCreate = NonTransportCreateBase.and(
  z.object({ type: z.literal('activity') }),
);
const MealCreate = NonTransportCreateBase.and(
  z.object({ type: z.literal('meal') }),
);
const NoteCreate = NonTransportCreateBase.and(
  z.object({ type: z.literal('note') }),
);

export const CreateItineraryItemInput = z.union([
  TransportCreate,
  LodgingCreate,
  ActivityCreate,
  MealCreate,
  NoteCreate,
]);
export type CreateItineraryItemInput = z.infer<typeof CreateItineraryItemInput>;

/* ---------------------------------------------------------------------------
 * PATCH — looser shape because callers may patch arbitrary subsets and the
 * server resolves the three type-change cases (a/b/c per SOLUTION_DESIGN
 * §B-007.2). The route layer enforces the AC-10 rule that `cost`/`currency`
 * MUST NOT be present on the parent when the resulting type is 'transport'.
 * ------------------------------------------------------------------------- */

export const UpdateItineraryItemInput = z
  .object({
    day_id: UuidSchema.nullable().optional(),
    type: ItineraryItemType.optional(),
    start_time: IsoDateTimeSchema.nullable().optional(),
    end_time: IsoDateTimeSchema.nullable().optional(),
    title: z.string().min(1).max(200).optional(),
    external_url: z.string().url().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    cost: z.number().nonnegative().nullable().optional(),
    currency: Iso4217Schema.nullable().optional(),
    transportation: TransportationPatch.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field is required',
  })
  .refine(
    (d) =>
      !d.start_time ||
      !d.end_time ||
      Date.parse(d.end_time) >= Date.parse(d.start_time),
    { message: 'end_time must be on or after start_time', path: ['end_time'] },
  );
export type UpdateItineraryItemInput = z.infer<typeof UpdateItineraryItemInput>;

/* ---------------------------------------------------------------------------
 * Row schemas — validate Supabase responses without unsafe `as` casts.
 * Mirror the `itinerary_items` table shape (post-migrations 0006/0008).
 * ------------------------------------------------------------------------- */

export const ItineraryItemRowSchema = z.object({
  id: z.string().uuid(),
  trip_id: z.string().uuid(),
  day_id: z.string().uuid().nullable(),
  type: ItineraryItemType,
  title: z.string(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  external_url: z.string().nullable(),
  cost: z.number().nullable(),
  currency: z.string().nullable(),
  notes: z.string().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ItineraryItemRow = z.infer<typeof ItineraryItemRowSchema>;
