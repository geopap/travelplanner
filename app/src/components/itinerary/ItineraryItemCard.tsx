import type { ItineraryItem, ItineraryItemType } from "@/lib/types/domain";
import { formatCurrency, formatTime } from "@/lib/utils/format";

interface ItineraryItemCardProps {
  item: ItineraryItem;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

const TYPE_META: Record<
  ItineraryItemType,
  { label: string; icon: string; tone: string }
> = {
  transport: {
    label: "Transport",
    icon: "✈",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  },
  lodging: {
    label: "Lodging",
    icon: "⌂",
    tone: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300",
  },
  activity: {
    label: "Activity",
    icon: "☼",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  },
  meal: {
    label: "Meal",
    icon: "◈",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  },
  note: {
    label: "Note",
    icon: "✎",
    tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
};

export function ItineraryItemCard({
  item,
  canEdit,
  onEdit,
  onDelete,
}: ItineraryItemCardProps) {
  const meta = TYPE_META[item.type];
  const start = formatTime(item.start_time);
  const end = formatTime(item.end_time);
  const timeLabel = start && end ? `${start} – ${end}` : start || end || "";

  return (
    <li className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base ${meta.tone}`}
          aria-label={meta.label}
        >
          {meta.icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.tone}`}
            >
              {meta.label}
            </span>
            {timeLabel && (
              <span className="text-xs text-zinc-500">{timeLabel}</span>
            )}
          </div>
          <h4 className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {item.title}
          </h4>
          {item.notes && (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
              {item.notes}
            </p>
          )}
          {item.cost !== null && (
            <p className="mt-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {formatCurrency(item.cost, item.currency)}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-1 shrink-0">
            <button
              type="button"
              onClick={onEdit}
              className="h-8 px-3 rounded-full border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="h-8 px-3 rounded-full border border-red-300 dark:border-red-900 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
