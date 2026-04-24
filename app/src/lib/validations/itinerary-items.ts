import { z } from 'zod';
import {
  IsoDateTimeSchema,
  Iso4217Schema,
  UuidSchema,
} from './common';

export const ItineraryItemType = z.enum([
  'transport',
  'lodging',
  'activity',
  'meal',
  'note',
]);
export type ItineraryItemType = z.infer<typeof ItineraryItemType>;

export const CreateItineraryItemInput = z
  .object({
    day_id: UuidSchema.nullable().optional(),
    type: ItineraryItemType,
    start_time: IsoDateTimeSchema.nullable().optional(),
    end_time: IsoDateTimeSchema.nullable().optional(),
    title: z.string().min(1).max(200),
    external_url: z.string().url().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    cost: z.number().nonnegative().nullable().optional(),
    currency: Iso4217Schema.nullable().optional(),
  })
  .refine(
    (d) =>
      !d.start_time ||
      !d.end_time ||
      Date.parse(d.end_time) >= Date.parse(d.start_time),
    { message: 'end_time must be on or after start_time', path: ['end_time'] },
  );
export type CreateItineraryItemInput = z.infer<typeof CreateItineraryItemInput>;

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
