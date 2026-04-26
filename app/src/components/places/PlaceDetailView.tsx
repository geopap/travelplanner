// Server component that renders the full Place detail page from a
// `PlaceDetail` payload returned by GET /api/places/[googlePlaceId].
//
// Sections:
//   - Header: name, category badge, rating
//   - Address (with copy-to-clipboard button)
//   - Phone (tel: link), Website (sanitised — http/https only)
//   - Opening hours
//   - Photo gallery
//   - Google Maps deep link
//   - Google attribution footer (Powered by Google + author attributions)

import type { ReactNode } from "react";
import type { PhotoAttribution, PlaceDetail } from "@/lib/types/domain";
import { PlaceCategoryBadge } from "@/components/places/PlaceCategoryBadge";
import { OpeningHours } from "@/components/places/OpeningHours";
import { PhotoGallery } from "@/components/places/PhotoGallery";
import { GoogleAttribution } from "@/components/places/GoogleAttribution";
import { CopyAddressButton } from "@/components/places/CopyAddressButton";

interface PlaceDetailViewProps {
  detail: PlaceDetail;
  /**
   * Slot rendered after the Google Maps CTA. The page server-component
   * mounts the `BookmarkButton` here only when the viewer is authenticated.
   */
  bookmarkSlot?: ReactNode;
}

/**
 * Permit only http(s) URLs. Anything else (javascript:, data:, mailto:, etc.)
 * collapses to null — we then hide the website link entirely.
 */
function sanitizeWebsite(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function formatRating(rating: number | null): string {
  if (rating === null) return "Not rated";
  return rating.toFixed(1);
}

export function PlaceDetailView({ detail, bookmarkSlot }: PlaceDetailViewProps) {
  const safeWebsite = sanitizeWebsite(detail.website);
  const photoAttributions: PhotoAttribution[] = [];
  const seenAttributions = new Set<string>();
  for (const photo of detail.photos) {
    for (const a of photo.attributions) {
      if (!a || !a.name) continue;
      const key = `${a.name}|${a.uri ?? ""}`;
      if (seenAttributions.has(key)) continue;
      seenAttributions.add(key);
      photoAttributions.push(a);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <PlaceCategoryBadge category={detail.category} />
          {detail.source === "cache" ? (
            <span className="text-[11px] uppercase tracking-wider text-zinc-400">
              Cached
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
          {detail.name}
        </h1>
        <p
          aria-label="Rating"
          className="flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300"
        >
          <span aria-hidden="true" className="text-amber-500">
            {"\u2605"}
          </span>
          <span className="font-medium">{formatRating(detail.rating)}</span>
          {detail.user_ratings_total !== null && detail.rating !== null ? (
            <span className="text-zinc-500 dark:text-zinc-400">
              ({detail.user_ratings_total.toLocaleString("en-US")} reviews)
            </span>
          ) : null}
        </p>
      </header>

      {detail.formatted_address ? (
        <section aria-labelledby="address-heading" className="mt-6">
          <h2
            id="address-heading"
            className="sr-only"
          >
            Address
          </h2>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-800 dark:text-zinc-200">
              {detail.formatted_address}
            </p>
            <CopyAddressButton value={detail.formatted_address} />
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="contact-heading"
        className="mt-6 grid gap-3 sm:grid-cols-2"
      >
        <h2 id="contact-heading" className="sr-only">
          Contact
        </h2>
        {detail.phone ? (
          <a
            href={`tel:${detail.phone}`}
            className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-label={`Call ${detail.phone}`}
          >
            <span className="block text-[11px] uppercase tracking-wider text-zinc-500">
              Phone
            </span>
            <span className="font-medium">{detail.phone}</span>
          </a>
        ) : null}
        {safeWebsite ? (
          <a
            href={safeWebsite}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-800 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            aria-label="Open website in a new tab"
          >
            <span className="block text-[11px] uppercase tracking-wider text-zinc-500">
              Website
            </span>
            <span className="block truncate font-medium">{safeWebsite}</span>
          </a>
        ) : null}
      </section>

      <section aria-labelledby="hours-heading" className="mt-6">
        <h2
          id="hours-heading"
          className="text-sm font-semibold uppercase tracking-wider text-zinc-500"
        >
          Hours
        </h2>
        <div className="mt-2">
          <OpeningHours hours={detail.opening_hours} />
        </div>
      </section>

      <section aria-labelledby="photos-heading" className="mt-6">
        <h2
          id="photos-heading"
          className="text-sm font-semibold uppercase tracking-wider text-zinc-500"
        >
          Photos
        </h2>
        <div className="mt-2">
          <PhotoGallery
            googlePlaceId={detail.google_place_id}
            placeName={detail.name}
            photos={detail.photos}
          />
        </div>
      </section>

      {detail.google_maps_url ? (
        <section className="mt-6">
          <a
            href={detail.google_maps_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            aria-label="Open in Google Maps"
          >
            Open in Google Maps
          </a>
        </section>
      ) : null}

      {bookmarkSlot ? <section className="mt-2">{bookmarkSlot}</section> : null}

      <GoogleAttribution attributions={photoAttributions} />
    </main>
  );
}
