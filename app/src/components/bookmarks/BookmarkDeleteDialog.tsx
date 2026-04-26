"use client";

// B-011 — Confirmation dialog for deleting a bookmark. Wraps the shared
// `ConfirmDeleteDialog` and performs the DELETE call against
// /api/trips/[tripId]/bookmarks/[id].

import { useState } from "react";
import type { Bookmark } from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

interface BookmarkDeleteDialogProps {
  open: boolean;
  tripId: string;
  bookmark: Bookmark | null;
  onCancel: () => void;
  onDeleted: (bookmark: Bookmark) => void;
}

export function BookmarkDeleteDialog({
  open,
  tripId,
  bookmark,
  onCancel,
  onDeleted,
}: BookmarkDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    if (!bookmark) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch<void>(
        `/api/trips/${encodeURIComponent(tripId)}/bookmarks/${encodeURIComponent(bookmark.id)}`,
        { method: "DELETE" },
      );
      onDeleted(bookmark);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.code === "forbidden"
            ? "You don't have permission."
            : err.message
          : "Could not delete the bookmark. Please try again.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const placeName = bookmark?.place?.name ?? "this place";

  return (
    <ConfirmDeleteDialog
      open={open && bookmark !== null}
      title="Remove bookmark?"
      description={`This will remove your bookmark for “${placeName}”. The place itself remains.`}
      confirmLabel="Remove bookmark"
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={() => {
        if (busy) return;
        setError(null);
        onCancel();
      }}
    />
  );
}
