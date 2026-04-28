-- 0016_trip_members_profile_fk_rollback.sql
--
-- Drops the supplementary FK from `trip_members.user_id` to
-- `public.profiles(id)`. The original FK on the same column to
-- `auth.users(id)` is unaffected.

begin;

alter table public.trip_members
  drop constraint if exists trip_members_profile_fk;

commit;
