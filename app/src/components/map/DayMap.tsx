"use client";

// B-015 — Leaflet day-view map. Renders one marker per itinerary item that has
// a linked, plottable place. Auto-fits bounds on mount and whenever the
// `items` array reference changes (which it does when DayMapSection re-mounts
// after re-opening the collapsible).
//
// SSR safety: this component imports `leaflet` at module scope and must NEVER
// be rendered on the server. Always import via `next/dynamic({ ssr: false })`
// (see DayMapSection.tsx).

import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Webpack/Next-asset marker icon fix. Leaflet's default CSS references icon
// images via relative URLs that break under Next bundling, so we rewrite the
// default icon URLs to bundled asset URLs at module-load time.
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

type LeafletIconDefault = L.Icon.Default & {
  _getIconUrl?: unknown;
};

(function applyDefaultIconFix() {
  const proto = L.Icon.Default.prototype as LeafletIconDefault;
  if (proto._getIconUrl !== undefined) {
    delete proto._getIconUrl;
  }
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      typeof iconRetinaUrl === "string"
        ? iconRetinaUrl
        : (iconRetinaUrl as { src: string }).src,
    iconUrl:
      typeof iconUrl === "string"
        ? iconUrl
        : (iconUrl as { src: string }).src,
    shadowUrl:
      typeof shadowUrl === "string"
        ? shadowUrl
        : (shadowUrl as { src: string }).src,
  });
})();

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

export interface DayMapItem {
  id: string;
  title: string;
  start_time: string | null;
  place: { lat: number; lng: number };
}

/**
 * B-023 — accommodation marker. Same uniform bed icon across all four
 * `indicator_type` values (per AC 10); the popup label distinguishes them.
 * `popupLabel` is pre-formatted by the section (date already localized).
 */
export interface DayMapAccommodation {
  id: string;
  hotelName: string;
  popupLabel: string;
  place: { lat: number; lng: number };
}

interface DayMapProps {
  items: DayMapItem[];
  /** B-023 — accommodation markers covering this day. May be empty. */
  accommodations?: DayMapAccommodation[];
}

/**
 * B-023 — uniform bed icon for accommodation markers. Inline SVG bed glyph on
 * an indigo pin to visually separate hotels from item pins (default blue).
 * `divIcon` rather than a bundled asset keeps us within the existing
 * marker-asset-fix convention without adding a new image to the build.
 */
const ACCOMMODATION_ICON = L.divIcon({
  className: 'tp-b023-hotel-marker',
  iconSize: [30, 38],
  iconAnchor: [15, 36],
  popupAnchor: [0, -32],
  html:
    '<div style="' +
    'width:30px;height:38px;position:relative;' +
    'display:flex;align-items:center;justify-content:center;' +
    '" aria-hidden="true">' +
    '<svg viewBox="0 0 30 38" width="30" height="38" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M15 0c8.284 0 15 6.716 15 15 0 9.5-15 23-15 23S0 24.5 0 15C0 6.716 6.716 0 15 0z" fill="#4f46e5" stroke="#312e81" stroke-width="1"/>' +
    // Bed glyph centred in the top circle.
    '<g transform="translate(7,8)" fill="#ffffff">' +
    '<path d="M0 10h16v2H0z"/>' +
    '<path d="M0 4h7v6H0z"/>' +
    '<rect x="8" y="6" width="8" height="4" rx="1"/>' +
    '<rect x="0" y="2" width="2" height="10"/>' +
    '<rect x="14" y="2" width="2" height="10"/>' +
    '</g>' +
    '</svg>' +
    '</div>',
});

/**
 * Format an ISO-with-offset start_time as a short local-time label for popups.
 * Returns null when start_time is null (popup will omit the line — AC 3).
 */
function formatStartTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

/**
 * Imperatively fit bounds whenever the points array identity changes.
 * Lives as a child of <MapContainer/> so it has access to the map instance.
 */
function FitBounds({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  // Use a JSON key so we re-fit only when actual coords change (not on every
  // parent render).
  const key = useMemo(() => JSON.stringify(points), [points]);
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)));
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
    // `key` is the canonical coord-set identity (JSON-keyed from `points`); we
    // intentionally exclude `points` so stable-ref/mutated-array re-renders
    // don't re-fit when coords haven't changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export default function DayMap({
  items,
  accommodations = [],
}: DayMapProps): React.ReactElement {
  // Stable list of [lat,lng] tuples — drives both markers and FitBounds.
  // Combines item AND accommodation coords so auto-fit covers everything.
  const points = useMemo<Array<[number, number]>>(
    () => [
      ...items.map((it): [number, number] => [it.place.lat, it.place.lng]),
      ...accommodations.map((a): [number, number] => [
        a.place.lat,
        a.place.lng,
      ]),
    ],
    [items, accommodations],
  );

  // Initial view: first point or a neutral world view. FitBounds takes over on
  // mount; this is just to avoid a flash of empty grey tiles.
  const initialCenter: [number, number] = points[0] ?? [20, 0];
  const initialZoom = points.length > 0 ? 12 : 2;

  return (
    <div
      className="h-72 sm:h-96 w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
      // Leaflet needs the container to have an explicit height to render tiles.
    >
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
        aria-label="Map of itinerary stops for this day"
      >
        <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
        <FitBounds points={points} />
        {items.map((it) => {
          const time = formatStartTime(it.start_time);
          return (
            <Marker key={it.id} position={[it.place.lat, it.place.lng]}>
              <Popup>
                <div className="text-sm">
                  <p className="font-medium text-zinc-900">{it.title}</p>
                  {time && (
                    <p className="mt-0.5 text-xs text-zinc-600">{time}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {accommodations.map((a) => (
          <Marker
            key={`acc-${a.id}`}
            position={[a.place.lat, a.place.lng]}
            icon={ACCOMMODATION_ICON}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-medium text-zinc-900">{a.hotelName}</p>
                <p className="mt-0.5 text-xs text-zinc-600">{a.popupLabel}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
