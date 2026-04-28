-- 0011_trello_import_rollback.sql  |  Sprint 4  |  B-016 rollback
--
-- PREREQUISITE: re-asserting `bookmarks.place_id NOT NULL` will fail if any
-- importer-created bookmark rows still exist with null `place_id`. Before
-- running this rollback, delete those rows for the affected trip(s):
--
--   delete from public.bookmarks
--    where source_card_id is not null
--      and place_id is null
--      and trip_id = '<japan-trip-uuid>';
--
-- (Repeat for every trip seeded by the importer; or simply
--  `delete from public.bookmarks where source_card_id is not null;`
--  if you want to drop ALL importer bookmarks regardless of trip.)
--
-- After deleting, run this script.

begin;

-- 0. Restore the original transportation.mode CHECK (no 'other').
--    PREREQUISITE: any rows with mode='other' must be reassigned/deleted
--    before this constraint can be re-applied.
alter table public.transportation
  drop constraint if exists transportation_mode_check;

alter table public.transportation
  add constraint transportation_mode_check
  check (mode in ('flight','train','bus','car','ferry'));

-- 1. Restore bookmarks place_id NOT NULL + classic unique constraint.
drop index if exists public.bookmarks_trip_place_category_uniq;

alter table public.bookmarks
  drop constraint if exists bookmarks_place_or_source_card;

alter table public.bookmarks alter column place_id set not null;

alter table public.bookmarks
  add constraint bookmarks_trip_id_place_id_category_key
  unique (trip_id, place_id, category);

-- 2. Drop idempotency indexes.
drop index if exists public.bookmarks_trip_source_card_uniq;
drop index if exists public.accommodations_trip_source_card_uniq;
drop index if exists public.itinerary_items_trip_source_card_uniq;

-- 3. Drop the source_card_id columns.
alter table public.bookmarks       drop column if exists source_card_id;
alter table public.accommodations  drop column if exists source_card_id;
alter table public.itinerary_items drop column if exists source_card_id;

commit;
