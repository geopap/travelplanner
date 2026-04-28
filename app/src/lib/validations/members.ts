/**
 * B-013 — Zod schemas for member-management requests.
 *
 * Source of truth for request shapes; route handlers MUST validate input
 * via these schemas before touching the database.
 */

import { z } from 'zod';

export const TripRoleSchema = z.enum(['owner', 'editor', 'viewer']);

export const MemberRoleUpdateSchema = z
  .object({
    role: TripRoleSchema,
  })
  .strict();

export type MemberRoleUpdateInput = z.infer<typeof MemberRoleUpdateSchema>;
