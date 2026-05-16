-- 0023_place_id_locked_rollback.sql  |  Sprint 7  |  B-026 rollback

begin;

-- Drop both signatures: pre-fix (uuid,uuid,uuid,uuid with p_actor) and
-- post-fix (uuid,uuid,uuid; actor derived from auth.uid()). Postgres treats
-- different signatures as different functions, so both must be cleaned up.
drop function if exists public.relink_place(uuid, uuid, uuid, uuid);
drop function if exists public.relink_place(uuid, uuid, uuid);

drop index if exists public.itinerary_items_trip_place_idx;
drop index if exists public.bookmarks_trip_place_idx;

alter table public.itinerary_items drop column if exists place_id_locked;
alter table public.bookmarks       drop column if exists place_id_locked;

commit;
