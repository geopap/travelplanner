-- 0014_expense_review_fixes_rollback.sql
--
-- Reverses 0014_expense_review_fixes.sql:
--   1. Drop `get_trip_expense_total(uuid)`.
--   2. Restore the original `expenses_update` policy (USING-only, no WITH CHECK)
--      to match the state after 0012_expenses.sql.

begin;

drop function if exists public.get_trip_expense_total(uuid);

drop policy if exists expenses_update on public.expenses;

create policy expenses_update on public.expenses
  for update using (public.is_trip_member(trip_id, 'editor'));

commit;
