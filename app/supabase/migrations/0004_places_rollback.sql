-- 0004_places_rollback.sql  |  Sprint 2  |  B-009
-- Reverses 0004_places.sql.

begin;

drop trigger if exists places_set_updated_at on public.places;
drop index  if exists public.places_category_idx;
drop table  if exists public.places;

commit;
