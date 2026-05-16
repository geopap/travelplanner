-- 0020_budget_includes_bookings.sql
--
-- Extends `get_trip_expense_total(p_trip_id)` to also count booking costs
-- against the trip budget:
--   - expenses.amount
--   - accommodations.total_cost (or cost_per_night × nights when total is null)
--   - transportation.cost
--   - itinerary_items.cost for non-transport types (transport carries cost on
--     the transportation row, not on the item)
--
-- Only rows whose currency matches the trip's `base_currency` are summed,
-- since the budget is denominated in base currency and we have no FX rates
-- in v1. Mixed-currency rows are silently excluded — the UI surfaces this.
--
-- ROLLBACK: 0020_budget_includes_bookings_rollback.sql restores the
-- expenses-only definition from 0014.

begin;

create or replace function public.get_trip_expense_total(p_trip_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with
    trip_ccy as (
      select base_currency from public.trips where id = p_trip_id
    ),
    expense_total as (
      select coalesce(sum(e.amount), 0)::numeric(14,2) as total
      from public.expenses e
      where e.trip_id = p_trip_id
    ),
    accommodation_total as (
      select coalesce(
        sum(
          case
            when a.total_cost is not null then a.total_cost
            when a.cost_per_night is not null then
              a.cost_per_night * greatest(
                (a.check_out_date - a.check_in_date)::int,
                0
              )
            else 0
          end
        ),
        0
      )::numeric(14,2) as total
      from public.accommodations a, trip_ccy tc
      where a.trip_id = p_trip_id
        and a.currency = tc.base_currency
    ),
    transport_total as (
      select coalesce(sum(t.cost), 0)::numeric(14,2) as total
      from public.transportation t, trip_ccy tc
      where t.trip_id = p_trip_id
        and t.cost is not null
        and t.currency = tc.base_currency
    ),
    item_total as (
      select coalesce(sum(i.cost), 0)::numeric(14,2) as total
      from public.itinerary_items i, trip_ccy tc
      where i.trip_id = p_trip_id
        and i.type <> 'transport'
        and i.cost is not null
        and i.currency = tc.base_currency
    )
  select (
    (select total from expense_total) +
    (select total from accommodation_total) +
    (select total from transport_total) +
    (select total from item_total)
  )::numeric(14,2);
$$;

commit;
