-- 0015_trello_import_unique_fix_rollback.sql
--
-- Reverses 0015: drops the unique constraints and restores the partial
-- unique indexes from 0011. Note: this re-introduces the bug where
-- `.upsert(..., { onConflict: 'trip_id,source_card_id' })` fails. Only
-- roll back if reverting 0011 as well.

begin;

alter table public.itinerary_items
  drop constraint if exists itinerary_items_trip_source_card_uniq;

alter table public.accommodations
  drop constraint if exists accommodations_trip_source_card_uniq;

alter table public.bookmarks
  drop constraint if exists bookmarks_trip_source_card_uniq;

create unique index if not exists itinerary_items_trip_source_card_uniq
  on public.itinerary_items (trip_id, source_card_id)
  where source_card_id is not null;

create unique index if not exists accommodations_trip_source_card_uniq
  on public.accommodations (trip_id, source_card_id)
  where source_card_id is not null;

create unique index if not exists bookmarks_trip_source_card_uniq
  on public.bookmarks (trip_id, source_card_id)
  where source_card_id is not null;

commit;
