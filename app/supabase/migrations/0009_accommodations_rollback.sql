-- 0009_accommodations_rollback.sql  |  Sprint 3  |  B-008 — Accommodations
--
-- Reverses 0009_accommodations.sql. Drops in dependency order:
--   1. View `trip_day_accommodation_indicators` (depends on accommodations + trip_days).
--   2. Trip-range trigger + its function.
--   3. updated_at trigger (auto-dropped with the table, but listed for clarity).
--   4. The `accommodations` table (CASCADE — kills any dependent objects).
--
-- The partial / range / trip indexes are owned by the table and dropped with it.

begin;

drop view if exists public.trip_day_accommodation_indicators;

drop trigger if exists accommodations_within_trip on public.accommodations;
drop function if exists public.tg_accommodation_within_trip();

drop trigger if exists accommodations_set_updated_at on public.accommodations;

drop table if exists public.accommodations cascade;

commit;
