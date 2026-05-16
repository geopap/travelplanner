"use client";

// B-027 — SSR-safe wrapper around PlaceMiniMapInner for the /places/[id]
// detail page. Renders a fixed-height mini map with a single marker, or a
// neutral placeholder of the same height when lat/lng are missing (preserves
// layout — no shift).

import dynamic from "next/dynamic";

const PlaceMiniMapInner = dynamic(() => import("./PlaceMiniMapInner"), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      aria-label="Loading map"
      className="h-full w-full animate-pulse bg-zinc-100 dark:bg-zinc-800/60"
    />
  ),
});

interface PlaceMiniMapProps {
  lat: number | null;
  lng: number | null;
  name: string;
  formattedAddress: string | null;
}

const FRAME_CLASSES =
  "h-[200px] md:h-[256px] w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800";

export function PlaceMiniMap({
  lat,
  lng,
  name,
  formattedAddress,
}: PlaceMiniMapProps) {
  if (lat === null || lng === null) {
    return (
      <div
        className={`${FRAME_CLASSES} flex items-center justify-center bg-zinc-50 dark:bg-zinc-900/40`}
        role="img"
        aria-label="Map unavailable for this place"
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Map unavailable for this place
        </p>
      </div>
    );
  }

  return (
    <div className={FRAME_CLASSES}>
      <PlaceMiniMapInner
        lat={lat}
        lng={lng}
        name={name}
        formattedAddress={formattedAddress}
      />
    </div>
  );
}
