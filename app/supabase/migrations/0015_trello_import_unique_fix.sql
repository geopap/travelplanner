-- 0015_trello_import_unique_fix.sql  |  Sprint 4 hotfix
--
-- Migration 0011 created PARTIAL unique indexes on
-- `(trip_id, source_card_id) WHERE source_card_id IS NOT NULL`. The Trello
-- importer uses Supabase JS `.upsert(..., { onConflict: 'trip_id,source_card_id' })`,
-- which surfaces as `INSERT ... ON CONFLICT (trip_id, source_card_id)` — but
-- Postgres cannot infer a partial index as the conflict target without an
-- explicit `WHERE` predicate, which PostgREST does not pass through. Result:
-- every importer upsert failed with
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Fix: drop the partial unique indexes; replace with non-partial unique
-- constraints on `(trip_id, source_card_id)`. Postgres treats NULLs as
-- distinct in a unique constraint, so existing UI-created rows with
-- `source_card_id IS NULL` continue to coexist on the same trip without
-- conflict — behavior equivalent to the partial index.
--
-- ROLLBACK: see 0015_trello_import_unique_fix_rollback.sql.

begin;

drop index if exists public.itinerary_items_trip_source_card_uniq;
drop index if exists public.accommodations_trip_source_card_uniq;
drop index if exists public.bookmarks_trip_source_card_uniq;

alter table public.itinerary_items
  add constraint itinerary_items_trip_source_card_uniq
  unique (trip_id, source_card_id);

alter table public.accommodations
  add constraint accommodations_trip_source_card_uniq
  unique (trip_id, source_card_id);

alter table public.bookmarks
  add constraint bookmarks_trip_source_card_uniq
  unique (trip_id, source_card_id);

commit;
