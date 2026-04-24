import { z } from 'zod';

export const UuidSchema = z.string().uuid();

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid ISO date (YYYY-MM-DD)')
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), {
    message: 'Invalid calendar date',
  });

export const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const Iso4217Schema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO-4217 code');

export const PageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageInput = z.infer<typeof PageSchema>;

/** Days between two YYYY-MM-DD strings (inclusive of both ends when equal = 0 diff). */
export function daysBetween(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}
