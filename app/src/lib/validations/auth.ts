import { z } from 'zod';

const PasswordComplexity = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((v) => /[a-z]/.test(v), 'Password must include a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must include an uppercase letter')
  .refine((v) => /\d/.test(v), 'Password must include a digit');

export const SignupInput = z
  .object({
    email: z.string().email().max(254),
    password: PasswordComplexity,
    confirm_password: z.string(),
    invite_token: z
      .string()
      .min(16)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/, 'Invalid token format'),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

export type SignupInput = z.infer<typeof SignupInput>;

export const SigninInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});
export type SigninInput = z.infer<typeof SigninInput>;

export const PasswordResetInput = z.object({
  email: z.string().email().max(254),
});
export type PasswordResetInput = z.infer<typeof PasswordResetInput>;

export const PasswordResetCompleteInput = z
  .object({
    access_token: z.string().min(10).max(4096),
    password: PasswordComplexity,
    confirm_password: z.string(),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });
export type PasswordResetCompleteInput = z.infer<
  typeof PasswordResetCompleteInput
>;
