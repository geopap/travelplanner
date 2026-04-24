"use client";

import type { ItineraryItemType } from "@/lib/types/domain";

const OPTIONS: ReadonlyArray<{
  value: ItineraryItemType;
  label: string;
  icon: string;
}> = [
  { value: "transport", label: "Transport", icon: "✈" },
  { value: "lodging", label: "Lodging", icon: "⌂" },
  { value: "activity", label: "Activity", icon: "☼" },
  { value: "meal", label: "Meal", icon: "◈" },
  { value: "note", label: "Note", icon: "✎" },
];

interface ItemTypePickerProps {
  value: ItineraryItemType;
  onChange: (value: ItineraryItemType) => void;
  disabled?: boolean;
}

export function ItemTypePicker({
  value,
  onChange,
  disabled,
}: ItemTypePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Item type"
      className="grid grid-cols-5 gap-1.5"
    >
      {OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`flex flex-col items-center justify-center gap-1 h-16 rounded-lg border text-xs font-medium transition-colors ${
              selected
                ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            } disabled:opacity-50`}
          >
            <span aria-hidden="true" className="text-base">
              {opt.icon}
            </span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
