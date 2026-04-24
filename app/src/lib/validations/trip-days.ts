import { z } from 'zod';

export const UpdateTripDayInput = z
  .object({
    title: z.string().max(120).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .refine((d) => d.title !== undefined || d.notes !== undefined, {
    message: 'At least one of title or notes is required',
  });
export type UpdateTripDayInput = z.infer<typeof UpdateTripDayInput>;
