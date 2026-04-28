import { z } from 'zod';

/**
 * Body schema for `PATCH /api/profile` (B-017).
 *
 * Both fields are optional but at least one must be supplied. `full_name` is
 * trimmed server-side; the empty string after trim is rejected as a validation
 * error. `avatar_url` must be an https URL (public Storage URL produced by the
 * client after a direct upload to the `avatars` bucket).
 *
 * Avatar bytes never traverse this API — only the resulting URL is patched.
 */
export const UpdateProfileInput = z
  .object({
    full_name: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => s.length >= 1 && s.length <= 80, {
        message: 'full_name must be 1..80 characters after trim',
      })
      .nullable()
      .optional(),
    avatar_url: z
      .string()
      .url()
      .max(1024)
      .refine((u) => u.startsWith('https://'), {
        message: 'avatar_url must use https',
      })
      .nullable()
      .optional(),
  })
  .refine(
    (d) => d.full_name !== undefined || d.avatar_url !== undefined,
    { message: 'At least one field is required' },
  );

export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;
