"use client";

import { useState } from "react";
import { InvitationForm } from "./InvitationForm";
import { PendingInvitationsList } from "./PendingInvitationsList";

interface MembersPanelProps {
  tripId: string;
}

export function MembersPanel({ tripId }: MembersPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="grid gap-6">
      <InvitationForm
        tripId={tripId}
        onCreated={() => setRefreshKey((n) => n + 1)}
      />
      <section>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
          Pending invitations
        </h2>
        <PendingInvitationsList tripId={tripId} refreshKey={refreshKey} />
      </section>
    </div>
  );
}
