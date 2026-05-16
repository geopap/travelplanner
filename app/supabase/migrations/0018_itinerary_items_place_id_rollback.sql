-- 0018_itinerary_items_place_id_rollback.sql  |  Sprint 5  |  B-015
--
-- Drops the place_id FK + index from `itinerary_items`.
--
-- Safe to run: column is nullable and no other migrations depend on it.
-- Any data in the column is lost on rollback (the link from item -> place is
-- only used by the B-015 map view, so functional impact is "map shows fewer
-- markers" until the migration is re-applied).

begin;

drop index if exists public.idx_itinerary_items_place_id;

alter table public.itinerary_items
  drop column if exists place_id;

commit;
