// Shared member-related helpers. Extracted from MembersList and
// MemberRoleControls (R4 LOW finding — duplication).

import type { MemberRole } from "@/lib/types/domain";

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};
