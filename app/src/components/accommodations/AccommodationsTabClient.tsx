"use client";

// B-008 — Client wrapper for the accommodations tab. Renders the list and
// the "Add accommodation" entry point (editor/owner only). Splitting this
// from the page keeps the dynamic create-dialog state out of the server
// component while still letting the page be SSR-rendered.

import { useState } from "react";
import type { MemberRole } from "@/lib/types/domain";
import { primaryButtonClass } from "@/components/ui/FormField";
import { AccommodationsList } from "./AccommodationsList";
import { AccommodationForm } from "./AccommodationForm";

interface AccommodationsTabClientProps {
  tripId: string;
  role: MemberRole;
  tripStartDate: string;
  tripEndDate: string;
  tripBaseCurrency: string;
}

export function AccommodationsTabClient({
  tripId,
  role,
  tripStartDate,
  tripEndDate,
  tripBaseCurrency,
}: AccommodationsTabClientProps) {
  const canEdit = role === "owner" || role === "editor";
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={primaryButtonClass}
          >
            Add accommodation
          </button>
        </div>
      )}

      {/* `key` forces the list+hook to remount after a successful create so
          the new row shows immediately without bespoke cache plumbing. */}
      <AccommodationsList
        key={refreshKey}
        tripId={tripId}
        role={role}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        tripBaseCurrency={tripBaseCurrency}
        onAddRequested={canEdit ? () => setCreating(true) : undefined}
      />

      {creating && (
        <AccommodationForm
          mode="create"
          tripId={tripId}
          tripStartDate={tripStartDate}
          tripEndDate={tripEndDate}
          tripBaseCurrency={tripBaseCurrency}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
