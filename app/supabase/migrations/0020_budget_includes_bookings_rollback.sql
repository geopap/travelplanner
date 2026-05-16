-- Rollback for 0020_budget_includes_bookings.sql.
-- Restores `get_trip_expense_total` to the expenses-only definition from 0014.

begin;

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

commit;
