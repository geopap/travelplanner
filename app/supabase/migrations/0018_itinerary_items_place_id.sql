-- 0018_itinerary_items_place_id.sql  |  Sprint 5  |  B-015 — Leaflet map (day view)
--
-- Adds a nullable `place_id` FK from `itinerary_items` to `places(id)` so the
-- day-view map (B-015) can plot itinerary items at their resolved lat/lng.
--
-- - Nullable: most itinerary items remain free-text (no geocoded place).
-- - ON DELETE SET NULL: deleting a cached `places` row must not cascade-delete
--   itinerary items; the item stays, the marker just disappears from the map.
-- - Index `idx_itinerary_items_place_id`: the day-view query LEFT JOINs places
--   on this column for every day fetch, so it must be covered.
-- - No RLS changes: `itinerary_items` is already RLS'd by trip membership and
--   `places` is readable by any authenticated user (per 0004_places.sql).
--
-- Rollback: see 0018_itinerary_items_place_id_rollback.sql

begin;

alter table public.itinerary_items
  add column place_id uuid null
    references public.places(id) on delete set null;

create index idx_itinerary_items_place_id
  on public.itinerary_items (place_id)
  where place_id is not null;

comment on column public.itinerary_items.place_id is
  'Optional FK to places(id). When set, the day-view map (B-015) plots this item using places.lat/lng. ON DELETE SET NULL preserves the item if the cached place row is purged.';

commit;
