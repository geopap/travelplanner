-- 0007_bookmarks_rollback.sql  |  Sprint 2  |  B-011 rollback
--
-- Drops the `bookmarks` table and its trigger. Reusable helper functions
-- (`is_trip_member`, `tg_set_updated_at`) defined in 0001_init.sql remain
-- in place — they are shared with other tables.

begin;

drop trigger if exists bookmarks_set_updated_at on public.bookmarks;
drop table   if exists public.bookmarks cascade;

commit;
