-- Rollback for 0021_expenses_from_bookings.sql.
--
-- Drops the sync triggers + helper functions, removes synced expense rows,
-- drops the source_kind/source_id columns, and restores the 0020 union-based
-- definition of `get_trip_expense_total`.

begin;

-- Drop triggers
drop trigger if exists accommodations_sync_expense on public.accommodations;
drop trigger if exists transportation_sync_expense on public.transportation;
drop trigger if exists itinerary_items_sync_expense on public.itinerary_items;

-- Drop trigger functions + helpers
drop function if exists public.tg_accommodation_to_expense();
drop function if exists public.tg_transportation_to_expense();
drop function if exists public.tg_item_to_expense();
drop function if exists public.tg_sync_expense_from_booking(
  uuid, text, uuid, text, text, numeric, char, date, uuid
);
drop function if exists public.tg_default_payer(uuid, uuid);

-- Remove synced expense rows
delete from public.expenses where source_kind is not null;

-- Drop unique index + constraint + columns
drop index if exists public.expenses_source_unique_idx;
alter table public.expenses drop constraint if exists expenses_source_pair;
alter table public.expenses drop column if exists source_id;
alter table public.expenses drop column if exists source_kind;

-- Restore 0020's union-based total (bookings counted alongside expenses again).
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
