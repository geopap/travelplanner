import { z } from 'zod';
import { IsoDateSchema, Iso4217Schema, daysBetween } from './common';

const MAX_TRIP_DAYS = 365;

const baseShape = {
  name: z.string().min(1).max(120),
  start_date: IsoDateSchema,
  end_date: IsoDateSchema,
  destination: z.string().max(200).nullable().optional(),
  base_currency: Iso4217Schema,
  total_budget: z.number().nonnegative().nullable().optional(),
  cover_image_url: z.string().url().nullable().optional(),
};

export const CreateTripInput = z
  .object(baseShape)
  .refine((d) => d.end_date >= d.start_date, {
    message: 'end_date must be on or after start_date',
    path: ['end_date'],
  })
  .refine(
    (d) => daysBetween(d.start_date, d.end_date) <= MAX_TRIP_DAYS,
    {
      message: `Trip duration must be at most ${MAX_TRIP_DAYS} days`,
      path: ['end_date'],
    },
  );
export type CreateTripInput = z.infer<typeof CreateTripInput>;

export const UpdateTripInput = z
  .object({
    name: z.string().min(1).max(120).optional(),
    start_date: IsoDateSchema.optional(),
    end_date: IsoDateSchema.optional(),
    destination: z.string().max(200).nullable().optional(),
    base_currency: Iso4217Schema.optional(),
    total_budget: z.number().nonnegative().nullable().optional(),
    cover_image_url: z.string().url().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one field is required',
  })
  .refine(
    (d) =>
      !d.start_date || !d.end_date || d.end_date >= d.start_date,
    { message: 'end_date must be on or after start_date', path: ['end_date'] },
  );
export type UpdateTripInput = z.infer<typeof UpdateTripInput>;

export const MAX_TRIP_DURATION_DAYS = MAX_TRIP_DAYS;
