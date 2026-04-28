/**
 * Shape of a row in `public.profiles` (see migration `0001_init.sql`).
 *
 * `email` is sourced from `auth.users` at signup and is not user-editable
 * through the profile API. `full_name` and `avatar_url` are user-controlled.
 */
export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Subset of `Profile` returned by `PATCH /api/profile`. */
export interface ProfileUpdateResult {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  updated_at: string;
}
