"use client";

// B-013 — Role dropdown + remove button shown to trip owners on each row
// of the members list. The controls enforce three client-side rules
// (defense-in-depth — server is authoritative):
//
//   1. Self row is read-only with a "(you)" label and no controls.
//   2. Sole-owner self-demotion: surfaces 409 `cannot_demote_sole_owner`.
//   3. Owner self-remove: surfaces 403 `owner_self_delete_forbidden` with
//      a hint pointing the user to the "delete trip" path.

import { useState } from "react";
import type { MemberRole } from "@/lib/types/domain";
import type { MemberWithProfile } from "@/lib/types/members";
import { ApiClientError } from "@/lib/utils/api-client";
import { updateMemberRole, removeMember } from "@/lib/hooks/useMembers";
import { TripRoleSchema } from "@/lib/validations/members";
import { ROLE_LABEL } from "@/lib/utils/members";
import { RemoveMemberDialog } from "./RemoveMemberDialog";

interface MemberRoleControlsProps {
  tripId: string;
  member: MemberWithProfile;
  /** UID of the currently signed-in user (page-resolved). */
  currentUserId: string;
  /** Display label used in the confirm dialog (full name or email). */
  memberLabel: string;
  /** Bumping this informs the parent list to refetch. */
  onChanged: () => void;
}

const ROLE_OPTIONS: MemberRole[] = ["owner", "editor", "viewer"];

export function MemberRoleControls({
  tripId,
  member,
  currentUserId,
  memberLabel,
  onChanged,
}: MemberRoleControlsProps) {
  const isSelf = member.user_id === currentUserId;

  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  // Local optimistic state — keeps the <select> in sync during the network
  // round-trip (parent reload would briefly snap the select back to the old
  // role otherwise). Reverts to `member.role` on error. React-19 "update
  // state from props" pattern: resync during render when the prop changes.
  const [selectedRole, setSelectedRole] = useState<MemberRole>(member.role);
  const [lastPropRole, setLastPropRole] = useState<MemberRole>(member.role);
  if (lastPropRole !== member.role) {
    setLastPropRole(member.role);
    setSelectedRole(member.role);
  }

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (isSelf) {
    // Self row is read-only — the (you) label is rendered by MembersList,
    // we just emit nothing for actions.
    return null;
  }

  async function handleRoleChange(next: MemberRole) {
    if (next === member.role) return;
    setRoleBusy(true);
    setRoleError(null);
    setSelectedRole(next);
    try {
      await updateMemberRole(tripId, member.user_id, next);
      onChanged();
    } catch (err) {
      // Revert optimistic update on failure.
      setSelectedRole(member.role);
      if (err instanceof ApiClientError) {
        if (err.code === "cannot_demote_sole_owner") {
          setRoleError(
            "You can't demote the sole owner. Promote another member to owner first.",
          );
        } else {
          setRoleError(err.message);
        }
      } else {
        setRoleError("Could not change role. Please try again.");
      }
    } finally {
      setRoleBusy(false);
    }
  }

  async function handleConfirmRemove() {
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await removeMember(tripId, member.user_id);
      setConfirmOpen(false);
      onChanged();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === "owner_self_delete_forbidden") {
          setRemoveError(
            "Owners can't remove themselves. To leave, delete the trip from the trip settings page.",
          );
        } else if (err.code === "cannot_demote_sole_owner") {
          setRemoveError(
            "You can't remove the sole owner. Promote another member to owner first.",
          );
        } else {
          setRemoveError(err.message);
        }
      } else {
        setRemoveError("Could not remove member. Please try again.");
      }
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <label
          htmlFor={`role-${member.user_id}`}
          className="sr-only"
        >
          Change role for {memberLabel}
        </label>
        <select
          id={`role-${member.user_id}`}
          value={selectedRole}
          disabled={roleBusy}
          onChange={(e) => {
            const parsed = TripRoleSchema.safeParse(e.target.value);
            if (parsed.success) void handleRoleChange(parsed.data);
          }}
          className="h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-300 disabled:opacity-50"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setRemoveError(null);
            setConfirmOpen(true);
          }}
          aria-label={`Remove ${memberLabel} from this trip`}
          className="h-9 px-3 rounded-full border border-red-300 dark:border-red-900 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-50"
          disabled={removeBusy}
        >
          Remove
        </button>
      </div>
      {roleError && (
        <p
          role="alert"
          className="text-xs text-red-600 dark:text-red-400 max-w-xs text-right"
        >
          {roleError}
        </p>
      )}

      <RemoveMemberDialog
        open={confirmOpen}
        memberLabel={memberLabel}
        memberRole={member.role}
        busy={removeBusy}
        error={removeError}
        onConfirm={handleConfirmRemove}
        onCancel={() => {
          if (!removeBusy) {
            setConfirmOpen(false);
            setRemoveError(null);
          }
        }}
      />
    </div>
  );
}
