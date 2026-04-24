"use client";

import { useEffect, useRef, useState } from "react";
import type { ItineraryItem, MemberRole, TripDay } from "@/lib/types/domain";
import { apiFetch, ApiClientError } from "@/lib/utils/api-client";
import { formatDate } from "@/lib/utils/format";
import { EmptyState } from "@/components/EmptyState";
import { ItineraryItemCard } from "./ItineraryItemCard";

interface DayCardProps {
  day: TripDay;
  items: ItineraryItem[];
  tripId: string;
  role: MemberRole;
  onTitleChange: (dayId: string, title: string | null) => void;
  onAddItem: (dayId: string) => void;
  onEditItem: (dayId: string, item: ItineraryItem) => void;
  onDeleteItem: (dayId: string, item: ItineraryItem) => void;
}

export function DayCard({
  day,
  items,
  tripId: _tripId,
  role,
  onTitleChange,
  onAddItem,
  onEditItem,
  onDeleteItem,
}: DayCardProps) {
  void _tripId; // reserved for future per-item operations that need tripId
  const canEdit = role === "owner" || role === "editor";
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(day.title ?? "");
  const [lastTitle, setLastTitle] = useState<string | null>(day.title);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resync draft when incoming day.title prop changes (e.g. after a successful
  // save from another path). React 19-safe "update state from props" pattern.
  if (lastTitle !== day.title) {
    setLastTitle(day.title);
    if (!editing) {
      setDraftTitle(day.title ?? "");
    }
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commitTitle() {
    const next = draftTitle.trim();
    const current = day.title ?? "";
    if (next === current) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch<{ day: TripDay }>(
        `/api/trips/${day.trip_id}/days/${day.id}`,
        {
          method: "PATCH",
          body: { title: next.length > 0 ? next : null },
        },
      );
      onTitleChange(day.id, res.day.title);
      setEditing(false);
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Could not save. Please try again.";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      id={`day-${day.day_number}`}
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 scroll-mt-20"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Day {day.day_number} · {formatDate(day.date)}
          </p>
          {editing ? (
            <div className="mt-1 flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                maxLength={120}
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void commitTitle();
                  } else if (e.key === "Escape") {
                    setDraftTitle(day.title ?? "");
                    setEditing(false);
                  }
                }}
                disabled={saving}
                placeholder="Add a day title…"
                className="flex-1 h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-300"
              />
            </div>
          ) : (
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => canEdit && setEditing(true)}
              className={`mt-1 block text-left text-lg font-semibold text-zinc-900 dark:text-zinc-50 ${
                canEdit
                  ? "hover:underline underline-offset-4 decoration-dashed"
                  : "cursor-default"
              }`}
              aria-label={canEdit ? "Edit day title" : undefined}
            >
              {day.title && day.title.trim().length > 0 ? (
                day.title
              ) : (
                <span className="text-zinc-400 italic font-normal">
                  {canEdit ? "Add a day title" : "No title"}
                </span>
              )}
            </button>
          )}
          {saveError && (
            <p
              role="alert"
              className="mt-1 text-xs text-red-600 dark:text-red-400"
            >
              {saveError}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs text-zinc-500">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </header>

      <div className="mt-4">
        {items.length === 0 ? (
          canEdit ? (
            <EmptyState
              icon={
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="w-6 h-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 5v14M5 12h14"
                  />
                </svg>
              }
              title="Nothing planned yet"
              message="Add the first item for this day — flight, hotel, activity, meal or note."
              ctaLabel="Add first item"
              onCtaClick={() => onAddItem(day.id)}
            />
          ) : (
            <p className="text-sm text-zinc-500">No items for this day.</p>
          )
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <ItineraryItemCard
                key={item.id}
                item={item}
                canEdit={canEdit}
                onEdit={() => onEditItem(day.id, item)}
                onDelete={() => onDeleteItem(day.id, item)}
              />
            ))}
          </ul>
        )}

        {canEdit && items.length > 0 && (
          <button
            type="button"
            onClick={() => onAddItem(day.id)}
            className="mt-3 w-full h-10 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            + Add another item
          </button>
        )}
      </div>
    </article>
  );
}
