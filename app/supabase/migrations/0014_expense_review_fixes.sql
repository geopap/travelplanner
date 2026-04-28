-- 0014_expense_review_fixes.sql  |  Sprint 4  |  B-014 R4 review fixes
--
-- Two changes (combined for cleaner apply order):
--   1. New SQL function `get_trip_expense_total(p_trip_id uuid) returns numeric`
--      — replaces the JS-side full-row-scan aggregate in
--      `GET /api/trips/[id]/expenses` (HIGH finding). One round-trip,
--      computed in Postgres via the existing `expenses_trip_occurred_idx`.
--   2. Replace `expenses_update` policy to add a `with check
--      (public.is_trip_member(trip_id, 'editor'))` clause (LOW finding —
--      defense-in-depth so a future code path can never UPDATE a row to
--      a `trip_id` the caller is not an editor of).
--
-- ROLLBACK: see 0014_expense_review_fixes_rollback.sql.

begin;

-- ============================================================================
-- 1. get_trip_expense_total — single-aggregate sum of expenses for a trip.
-- ============================================================================

create or replace function public.get_trip_expense_total(p_trip_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(amount), 0)::numeric(14,2)
  from public.expenses
  where trip_id = p_trip_id;
$$;

revoke all on function public.get_trip_expense_total(uuid) from public;
grant execute on function public.get_trip_expense_total(uuid) to authenticated;

-- ============================================================================
-- 2. expenses_update policy — add WITH CHECK clause.
--    Postgres requires DROP + CREATE to add a WITH CHECK to an existing
--    UPDATE policy. Idempotent: drop is `if exists`.
-- ============================================================================

drop policy if exists expenses_update on public.expenses;

create policy expenses_update on public.expenses
  for update
  using       (public.is_trip_member(trip_id, 'editor'))
  with check  (public.is_trip_member(trip_id, 'editor'));

commit;
