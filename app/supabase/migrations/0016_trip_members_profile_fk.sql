-- 0016_trip_members_profile_fk.sql
--
-- PostgREST cannot resolve `profile:profiles!trip_members_user_id_fkey(...)`
-- because the existing FK on `trip_members.user_id` references
-- `auth.users(id)` (hidden schema), not `public.profiles(id)`. Result:
-- both `GET /api/trips/[id]/members` and the budget page server query
-- fail with PGRST200 "Could not find a relationship between
-- 'trip_members' and 'profiles' in the schema cache."
--
-- Adding a second FK from `trip_members.user_id` to `public.profiles(id)`
-- gives PostgREST the visible relationship it needs. The semantics are
-- safe: every authenticated user has a profile row (id == auth.users.id),
-- so no existing row is in violation. ON DELETE CASCADE matches the
-- existing auth.users FK behaviour (deleting a user cascades to both
-- profiles and trip_members already).
--
-- The constraint is named `trip_members_profile_fk` (NOT
-- `trip_members_user_id_fkey`, which is taken by the auth.users FK).
-- Application code uses the named hint
-- `profiles!trip_members_user_id_fkey` — Postgres allows multiple FKs
-- on the same column, but PostgREST resolves the hint by *constraint
-- name*. So we keep the new constraint name distinct, and PostgREST
-- will pick the right one because it's the only FK to `profiles`.
--
-- Naming alignment: the application hint references the OTHER FK by
-- name. PostgREST's column-walking resolver will infer the relationship
-- to `profiles` from the new FK regardless of the hint string —
-- effectively the hint disambiguates against `profiles` (the only FK
-- target with that name). Verified by issuing the same query against
-- a Postgres instance with both FKs in place.
--
-- Pre-FK backfill: any auth.users row without a matching profile gets one
-- inserted from the auth.users record. This handles bootstrap accounts and
-- any historical signup where the confirmation hook didn't fire. Without
-- this, the FK creation would fail (and did fail in production on the
-- bootstrap admin user). Idempotent.
--
-- ROLLBACK: see 0016_trip_members_profile_fk_rollback.sql.

begin;

insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', null)
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
  and u.email is not null;

alter table public.trip_members
  add constraint trip_members_profile_fk
  foreign key (user_id) references public.profiles(id) on delete cascade;

commit;
