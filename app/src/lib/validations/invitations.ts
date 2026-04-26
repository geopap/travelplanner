import { z } from 'zod';

export const InvitationCreate = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['editor', 'viewer']),
});

export type InvitationCreateInput = z.infer<typeof InvitationCreate>;
