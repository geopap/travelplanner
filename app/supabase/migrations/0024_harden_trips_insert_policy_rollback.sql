-- Rollback for 0024_harden_trips_insert_policy.sql
-- Restores the original 0001_init.sql policy verbatim:
-- `for insert with check (owner_id = auth.uid())` (applies to all roles,
-- unwrapped auth.uid()).

begin;

drop policy if exists trips_insert on public.trips;

create policy trips_insert on public.trips
  for insert with check (owner_id = auth.uid());

commit;
