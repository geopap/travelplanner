-- 0011_trello_import.sql  |  Sprint 4  |  B-016 — Trello import schema delta
--
-- Adds an idempotency natural key (`source_card_id`) to the three import
-- target tables, so the one-shot importer at `app/scripts/import-trello.ts`
-- can upsert via `(trip_id, source_card_id)` without producing duplicates on
-- re-runs. Also relaxes `bookmarks.place_id` to nullable (the importer never
-- calls Google Places) and replaces the table-level unique constraint with
-- a partial index that keeps the UI-row invariant intact.
--
-- Reuses helpers from 0001_init.sql.
--
-- ROLLBACK: see 0011_trello_import_rollback.sql. The rollback re-asserts
-- `bookmarks.place_id NOT NULL` and so requires that any importer-created
-- rows with null `place_id` be deleted first (see rollback header).

begin;

-- ============================================================================
-- 1. Add nullable `source_card_id` (Trello card id) to import target tables.
-- ============================================================================

alter table public.itinerary_items add column if not exists source_card_id text;
alter table public.accommodations  add column if not exists source_card_id text;
alter table public.bookmarks       add column if not exists source_card_id text;

-- ============================================================================
-- 2. Per-table partial unique index — idempotency key for upsert.
--    `(trip_id, source_card_id) where source_card_id is not null` lets
--    UI-created rows leave the column null without colliding.
-- ============================================================================

create unique index if not exists itinerary_items_trip_source_card_uniq
  on public.itinerary_items (trip_id, source_card_id)
  where source_card_id is not null;

create unique index if not exists accommodations_trip_source_card_uniq
  on public.accommodations (trip_id, source_card_id)
  where source_card_id is not null;

create unique index if not exists bookmarks_trip_source_card_uniq
  on public.bookmarks (trip_id, source_card_id)
  where source_card_id is not null;

-- ============================================================================
-- 3. Relax `bookmarks.place_id` to nullable; preserve UI-row invariant via
--    a CHECK that requires either `place_id` or `source_card_id`.
--    The original Sprint-2 unique `(trip_id, place_id, category)` constraint
--    is replaced by a partial unique index scoped to UI rows (place_id NOT
--    NULL); importer-row dedup is handled by `bookmarks_trip_source_card_uniq`.
-- ============================================================================

alter table public.bookmarks alter column place_id drop not null;

alter table public.bookmarks
  drop constraint if exists bookmarks_trip_id_place_id_category_key;

alter table public.bookmarks
  drop constraint if exists bookmarks_place_or_source_card;

alter table public.bookmarks
  add constraint bookmarks_place_or_source_card
  check (place_id is not null or source_card_id is not null);

create unique index if not exists bookmarks_trip_place_category_uniq
  on public.bookmarks (trip_id, place_id, category)
  where place_id is not null;

-- ============================================================================
-- 4. Expand transportation.mode CHECK to allow 'other' — required by B-016
--    AC-5 (Trello cards under the Transportation label whose mode cannot be
--    inferred from the card name default to 'other').
-- ============================================================================

alter table public.transportation
  drop constraint if exists transportation_mode_check;

alter table public.transportation
  add constraint transportation_mode_check
  check (mode in ('flight','train','bus','car','ferry','other'));

commit;
