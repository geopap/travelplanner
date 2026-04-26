// Small colored chip that labels a place by category.
// Reusable across search results, bookmark cards, and itinerary item cards.

import type { PlaceCategory } from "@/lib/google/categories";

interface PlaceCategoryBadgeProps {
  category: PlaceCategory;
}

const LABELS: Record<PlaceCategory, string> = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  bar: "Bar",
  sight: "Sight",
  museum: "Museum",
  shopping: "Shopping",
  hotel: "Hotel",
  transport_hub: "Transport",
  park: "Park",
  other: "Other",
};

// Tailwind v4 utility classes — chosen for AA-contrast text on light/dark.
const COLORS: Record<PlaceCategory, string> = {
  restaurant:
    "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  cafe:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  bar: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  sight: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  museum:
    "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  shopping: "bg-pink-100 text-pink-900 dark:bg-pink-950 dark:text-pink-200",
  hotel: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  transport_hub:
    "bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100",
  park:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  other: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

export function PlaceCategoryBadge({ category }: PlaceCategoryBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${COLORS[category]}`}
    >
      {LABELS[category]}
    </span>
  );
}
