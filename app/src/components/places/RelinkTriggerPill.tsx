"use client";

// B-026 — Client island for the "Wrong place? Re-link…" pill that opens the
// RelinkPlaceDialog. PlaceDetailView is a server component; this island
// hosts the open-state and dialog mount.

import { useRef, useState } from "react";
import { RelinkPlaceDialog } from "@/components/places/RelinkPlaceDialog";

interface RelinkTriggerPillProps {
  tripId: string;
  fromPlaceId: string;
  currentPlaceName: string;
}

export function RelinkTriggerPill({
  tripId,
  fromPlaceId,
  currentPlaceName,
}: RelinkTriggerPillProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/60"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Wrong place? Re-link…
      </button>
      <RelinkPlaceDialog
        open={open}
        onClose={() => setOpen(false)}
        tripId={tripId}
        fromPlaceId={fromPlaceId}
        currentPlaceName={currentPlaceName}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
