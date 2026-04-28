-- 0012_expenses_rollback.sql  |  Sprint 4  |  B-014 — Budget & expenses
--
-- Reverses 0012_expenses.sql. Drops in dependency order:
--   1. RPC `get_trip_balances` (depends on expenses + trip_members).
--   2. Trip-range trigger + its function.
--   3. updated_at trigger (auto-dropped with the table; listed for clarity).
--   4. The `expenses` table (CASCADE — kills any dependent objects).
--
-- Indexes are owned by the table and dropped with it.

begin;

drop function if exists public.get_trip_balances(uuid);

drop trigger if exists expenses_within_trip on public.expenses;
drop function if exists public.tg_expense_within_trip();

drop trigger if exists expenses_set_updated_at on public.expenses;

drop table if exists public.expenses cascade;

commit;
