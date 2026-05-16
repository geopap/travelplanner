-- 0021_expenses_from_bookings.sql
--
-- Auto-syncs accommodation / transportation / itinerary-item costs into the
-- `expenses` table so they appear in the Expenses list (filtered by category)
-- and in the trip balances. The booking is the source of truth — synced
-- expense rows are read-only at the API/UI layer (enforced in app code; the
-- trigger overwrites edits on every booking update).
--
-- Changes:
--   1. Add `source_kind` + `source_id` columns to `expenses` (nullable; both
--      null = manual entry).
--   2. Unique partial index so each booking maps to at most one expense row.
--   3. Per-source triggers on accommodations / transportation / itinerary_items
--      that INSERT / UPDATE / DELETE the matching expense row in lock-step
--      with the booking's cost field(s).
--   4. Backfill: create synced expense rows for every existing booking that
--      has a cost in the trip base currency.
--   5. Revert `get_trip_expense_total` to expenses-only (bookings now flow
--      through expenses; counting both would double-count).
--
-- Defaults applied by the sync triggers:
--   - paid_by      = coalesce(booking.created_by, trip-owner profile, any
--                              trip member). Skip sync if none can be found.
--   - split_among  = [{user_id: paid_by, share_pct: 100}]
--   - category     = 'accommodation' (acc) | 'transport' (trans) | per-type
--                    mapping (items: meal→food, activity→activities, etc.)
--   - description  = hotel name / item title (truncated to 500 chars)
--   - amount       = total_cost OR cost_per_night × nights (acc) | cost (others)
--   - currency     = booking currency (only synced when it equals base; see
--                    `expenses_currency_matches_trip` below)
--   - occurred_at  = check_in_date (acc) | departure_time::date (trans, with
--                    fallback to trip.start_date) | day.date (items)
--
-- Mixed-currency bookings (booking.currency <> trip.base_currency) are NOT
-- synced — the budget cannot represent them faithfully in v1 (no FX rates).
--
-- ROLLBACK: see 0021_expenses_from_bookings_rollback.sql.

begin;

-- ============================================================================
-- 1. Schema additions
-- ============================================================================

alter table public.expenses
  add column source_kind text
    check (source_kind is null
           or source_kind in ('accommodation','transportation','itinerary_item')),
  add column source_id   uuid;

comment on column public.expenses.source_kind is
  'When non-null, this expense was synced from a booking row in the referenced table. Edits flow through the source row, not the expense.';

-- Both columns null (manual) OR both set (synced).
alter table public.expenses
  add constraint expenses_source_pair
  check ((source_kind is null) = (source_id is null));

-- At most one expense per booking.
create unique index expenses_source_unique_idx
  on public.expenses (source_kind, source_id)
  where source_kind is not null;

-- ============================================================================
-- 2. Helper — resolve a default paid_by for a synced expense.
--    Order: booking creator → first trip owner → any trip member → null
-- ============================================================================

create or replace function public.tg_default_payer(p_trip_id uuid, p_creator uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_creator,
    (select user_id from public.trip_members
      where trip_id = p_trip_id and role = 'owner'
      order by invited_at asc limit 1),
    (select user_id from public.trip_members
      where trip_id = p_trip_id
      order by invited_at asc limit 1)
  );
$$;

-- ============================================================================
-- 3. Helper — upsert/delete a synced expense row.
--    Bypasses the within-trip trigger? No — we rely on it. occurred_at is
--    derived to fall inside the trip range; if not, the trigger raises and
--    the booking write also fails (loud failure preferred over silent drift).
-- ============================================================================

create or replace function public.tg_sync_expense_from_booking(
  p_trip_id      uuid,
  p_source_kind  text,
  p_source_id    uuid,
  p_category     text,
  p_description  text,
  p_amount       numeric,
  p_currency     char(3),
  p_occurred_at  date,
  p_creator      uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_ccy char(3);
  v_payer    uuid;
  v_existing uuid;
begin
  -- Pull trip base currency; mixed-currency bookings are not synced.
  select base_currency into v_trip_ccy from public.trips where id = p_trip_id;
  if v_trip_ccy is null then
    return; -- trip gone; nothing to do
  end if;

  -- Resolve / locate the existing synced row.
  select id into v_existing
    from public.expenses
   where source_kind = p_source_kind and source_id = p_source_id;

  -- Conditions under which the booking should NOT have a synced expense:
  --   - cost is null / zero / negative (amount > 0 check on expenses)
  --   - currency mismatch (mixed-currency in v1)
  if p_amount is null or p_amount <= 0 or p_currency is null
     or p_currency <> v_trip_ccy then
    if v_existing is not null then
      delete from public.expenses where id = v_existing;
    end if;
    return;
  end if;

  v_payer := public.tg_default_payer(p_trip_id, p_creator);
  if v_payer is null then
    -- No member to assign — skip sync (loud no-op).
    return;
  end if;

  if v_existing is null then
    insert into public.expenses (
      trip_id, category, description, amount, currency, occurred_at,
      paid_by, split_among, created_by, source_kind, source_id
    ) values (
      p_trip_id,
      p_category,
      left(coalesce(nullif(trim(p_description), ''), 'Booking'), 500),
      p_amount,
      p_currency,
      p_occurred_at,
      v_payer,
      jsonb_build_array(jsonb_build_object('user_id', v_payer, 'share_pct', 100)),
      v_payer,
      p_source_kind,
      p_source_id
    );
  else
    update public.expenses
       set category    = p_category,
           description = left(coalesce(nullif(trim(p_description), ''), 'Booking'), 500),
           amount      = p_amount,
           currency    = p_currency,
           occurred_at = p_occurred_at
     where id = v_existing;
  end if;
end;
$$;

-- ============================================================================
-- 4. Trigger functions per source table
-- ============================================================================

-- 4a. Accommodations -----------------------------------------------------------

create or replace function public.tg_accommodation_to_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(14,2);
  v_nights int;
begin
  if tg_op = 'DELETE' then
    delete from public.expenses
     where source_kind = 'accommodation' and source_id = old.id;
    return old;
  end if;

  v_nights := greatest((new.check_out_date - new.check_in_date)::int, 0);
  v_amount := case
    when new.total_cost is not null then new.total_cost
    when new.cost_per_night is not null then (new.cost_per_night * v_nights)::numeric(14,2)
    else null
  end;

  perform public.tg_sync_expense_from_booking(
    new.trip_id,
    'accommodation',
    new.id,
    'accommodation',
    coalesce(new.hotel_name, 'Accommodation'),
    v_amount,
    new.currency,
    new.check_in_date,
    new.created_by
  );
  return new;
end;
$$;

drop trigger if exists accommodations_sync_expense on public.accommodations;
create trigger accommodations_sync_expense
  after insert or update or delete on public.accommodations
  for each row execute function public.tg_accommodation_to_expense();

-- 4b. Transportation -----------------------------------------------------------

create or replace function public.tg_transportation_to_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_when date;
  v_trip_start date;
begin
  if tg_op = 'DELETE' then
    delete from public.expenses
     where source_kind = 'transportation' and source_id = old.id;
    return old;
  end if;

  select start_date into v_trip_start from public.trips where id = new.trip_id;
  v_when := coalesce((new.departure_time at time zone 'utc')::date, v_trip_start);

  perform public.tg_sync_expense_from_booking(
    new.trip_id,
    'transportation',
    new.id,
    'transport',
    coalesce(
      nullif(trim(new.carrier), ''),
      initcap(new.mode) || ' transport'
    ),
    new.cost,
    new.currency,
    v_when,
    new.created_by
  );
  return new;
end;
$$;

drop trigger if exists transportation_sync_expense on public.transportation;
create trigger transportation_sync_expense
  after insert or update or delete on public.transportation
  for each row execute function public.tg_transportation_to_expense();

-- 4c. Itinerary items (non-transport, has cost) --------------------------------
--     For type='transport' the cost lives on the transportation row, so we
--     skip those rows in the trigger to avoid double-counting.

create or replace function public.tg_item_to_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_when      date;
  v_trip_start date;
  v_category  text;
begin
  if tg_op = 'DELETE' then
    delete from public.expenses
     where source_kind = 'itinerary_item' and source_id = old.id;
    return old;
  end if;

  if new.type = 'transport' then
    -- Transport items are synced via the transportation row, not here.
    delete from public.expenses
     where source_kind = 'itinerary_item' and source_id = new.id;
    return new;
  end if;

  v_category := case new.type
    when 'meal'     then 'food'
    when 'activity' then 'activities'
    when 'lodging'  then 'accommodation'
    else 'other'
  end;

  select start_date into v_trip_start from public.trips where id = new.trip_id;
  v_when := coalesce(
    (select date from public.trip_days where id = new.day_id),
    (new.start_time at time zone 'utc')::date,
    v_trip_start
  );

  perform public.tg_sync_expense_from_booking(
    new.trip_id,
    'itinerary_item',
    new.id,
    v_category,
    new.title,
    new.cost,
    new.currency,
    v_when,
    new.created_by
  );
  return new;
end;
$$;

drop trigger if exists itinerary_items_sync_expense on public.itinerary_items;
create trigger itinerary_items_sync_expense
  after insert or update or delete on public.itinerary_items
  for each row execute function public.tg_item_to_expense();

-- ============================================================================
-- 5. Backfill existing bookings
-- ============================================================================

-- Accommodations
do $$
declare r record;
begin
  for r in select * from public.accommodations loop
    perform public.tg_sync_expense_from_booking(
      r.trip_id,
      'accommodation',
      r.id,
      'accommodation',
      coalesce(r.hotel_name, 'Accommodation'),
      case
        when r.total_cost is not null then r.total_cost
        when r.cost_per_night is not null then
          (r.cost_per_night * greatest((r.check_out_date - r.check_in_date)::int, 0))::numeric(14,2)
        else null
      end,
      r.currency,
      r.check_in_date,
      r.created_by
    );
  end loop;
end$$;

-- Transportation
do $$
declare
  r record;
  v_when date;
  v_trip_start date;
begin
  for r in select * from public.transportation loop
    select start_date into v_trip_start from public.trips where id = r.trip_id;
    v_when := coalesce((r.departure_time at time zone 'utc')::date, v_trip_start);
    perform public.tg_sync_expense_from_booking(
      r.trip_id,
      'transportation',
      r.id,
      'transport',
      coalesce(nullif(trim(r.carrier), ''), initcap(r.mode) || ' transport'),
      r.cost,
      r.currency,
      v_when,
      r.created_by
    );
  end loop;
end$$;

-- Itinerary items (non-transport with a cost)
do $$
declare
  r record;
  v_when date;
  v_trip_start date;
  v_category text;
begin
  for r in select * from public.itinerary_items where type <> 'transport' and cost is not null loop
    select start_date into v_trip_start from public.trips where id = r.trip_id;
    v_when := coalesce(
      (select date from public.trip_days where id = r.day_id),
      (r.start_time at time zone 'utc')::date,
      v_trip_start
    );
    v_category := case r.type
      when 'meal'     then 'food'
      when 'activity' then 'activities'
      when 'lodging'  then 'accommodation'
      else 'other'
    end;
    perform public.tg_sync_expense_from_booking(
      r.trip_id,
      'itinerary_item',
      r.id,
      v_category,
      r.title,
      r.cost,
      r.currency,
      v_when,
      r.created_by
    );
  end loop;
end$$;

-- ============================================================================
-- 6. Revert get_trip_expense_total to expenses-only (bookings now flow
--    through expenses; 0020's UNION would double-count).
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

-- ============================================================================
-- 7. Grants
-- ============================================================================

revoke all on function public.tg_default_payer(uuid, uuid) from public;
revoke all on function public.tg_sync_expense_from_booking(
  uuid, text, uuid, text, text, numeric, char, date, uuid
) from public;
-- Trigger functions don't need explicit grants — they run as definer.

commit;
