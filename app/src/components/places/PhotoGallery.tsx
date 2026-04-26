// Responsive photo grid for a place. Photos are streamed via the auth-gated
// `/api/places/[googlePlaceId]/photo/[photoRef]` proxy — never directly from
// Google. We cap to 5 photos in v1 (no lightbox; spec defers that).
//
// Native lazy-loading is sufficient for a small grid. Each <img> declares
// width/height for layout stability and a meaningful alt text.

"use client";

import type { PhotoRef } from "@/lib/types/domain";

interface PhotoGalleryProps {
  googlePlaceId: string;
  placeName: string;
  photos: ReadonlyArray<PhotoRef>;
}

const MAX_PHOTOS = 5;
const PHOTO_MAX_WIDTH = 800;

export function PhotoGallery({
  googlePlaceId,
  placeName,
  photos,
}: PhotoGalleryProps) {
  if (photos.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No photos available.
      </p>
    );
  }

  const visible = photos.slice(0, MAX_PHOTOS);
  const idEnc = encodeURIComponent(googlePlaceId);

  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {visible.map((photo, idx) => {
        const refEnc = encodeURIComponent(photo.photo_reference);
        const src = `/api/places/${idEnc}/photo/${refEnc}?maxWidth=${PHOTO_MAX_WIDTH}`;
        return (
          <li
            key={photo.photo_reference}
            className="overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- proxy stream, not next/image-eligible */}
            <img
              src={src}
              alt={`${placeName} — photo ${idx + 1}`}
              loading="lazy"
              decoding="async"
              width={photo.width}
              height={photo.height}
              className="aspect-square w-full object-cover"
            />
          </li>
        );
      })}
    </ul>
  );
}
