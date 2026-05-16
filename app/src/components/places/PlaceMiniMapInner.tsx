"use client";

// B-027 — Read-only single-marker Leaflet map used on /places/[id]. Lives in
// its own file so PlaceMiniMap can next/dynamic-import it with ssr:false
// (leaflet touches `window` at module load).

import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

type LeafletIconDefault = L.Icon.Default & {
  _getIconUrl?: unknown;
};

// Same default-icon fix as DayMap — leaflet's CSS-referenced icons break
// under Next bundling.
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

interface PlaceMiniMapInnerProps {
  lat: number;
  lng: number;
  name: string;
  formattedAddress: string | null;
}

export default function PlaceMiniMapInner({
  lat,
  lng,
  name,
  formattedAddress,
}: PlaceMiniMapInnerProps): React.ReactElement {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%" }}
      aria-label={`Map showing ${name}`}
    >
      <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILE_URL} />
      <Marker position={[lat, lng]}>
        <Popup>
          <div className="text-sm">
            <p className="font-medium text-zinc-900">{name}</p>
            {formattedAddress ? (
              <p className="mt-0.5 text-xs text-zinc-600">{formattedAddress}</p>
            ) : null}
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
}
