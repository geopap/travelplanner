-- 0009_accommodations.sql  |  Sprint 3  |  B-008 — Accommodations
--
-- Creates the `accommodations` table for hotel/lodging stays attached to a
-- trip, plus the `trip_day_accommodation_indicators` view used by the day-view
-- to render per-day badges (Check in / Staying at / Check out / same day) in
-- a single batched query (no N+1).
--
-- Sprint-0 baseline (§2.9 of SOLUTION_DESIGN.md) defined an `accommodations`
-- table with `name not null` and a different shape; that baseline never had
-- API routes, so this migration drops + recreates it within a single
-- transaction. The Sprint-3 spec relaxes name-or-place (XOR/either), adds a
-- `created_by` audit column, an updated_at trigger, the partial place index,
-- a per-trip date-range trigger (defense-in-depth — Postgres CHECK can't
-- subquery), and the security-invoker view.
--
-- Reuses helpers from 0001_init.sql:
--   - public.is_trip_member(uuid, text)
--   - public.tg_set_updated_at()
--
-- ROLLBACK: see 0009_accommodations_rollback.sql. The rollback drops the
-- view, trigger function, table (cascade), and trigger.

begin;

-- ============================================================================
-- 0. Drop legacy baseline if present (Sprint-0 had a different shape).
-- ============================================================================

drop view if exists public.trip_day_accommodation_indicators;
drop table if exists public.accommodations cascade;

-- ============================================================================
-- 1. Table
-- ============================================================================

create table public.accommodations (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id)  on delete cascade,
  place_id        uuid references public.places(id)          on delete set null,
  hotel_name      text check (hotel_name is null or char_length(hotel_name) between 1 and 200),
  check_in_date   date not null,
  check_out_date  date not null,
  confirmation    text check (confirmation is null or char_length(confirmation) <= 80),
  cost_per_night  numeric(14,2) check (cost_per_night is null or cost_per_night >= 0),
  total_cost      numeric(14,2) check (total_cost is null or total_cost >= 0),
  currency        char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes           text check (notes is null or char_length(notes) <= 4000),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint accommodations_dates_valid
    check (check_out_date >= check_in_date),
  constraint accommodations_name_or_place
    check (place_id is not null or hotel_name is not null),
  constraint accommodations_cost_currency_paired
    check (
      (cost_per_night is null and total_cost is null)
      or currency is not null
    )
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

create index if not exists accommodations_trip_idx
  on public.accommodations (trip_id);

create index if not exists accommodations_trip_dates_idx
  on public.accommodations (trip_id, check_in_date, check_out_date);

create index if not exists accommodations_place_idx
  on public.accommodations (place_id)
  where place_id is not null;

-- ============================================================================
-- 3. updated_at trigger (reuses 0001_init.sql tg_set_updated_at())
-- ============================================================================

create trigger accommodations_set_updated_at
  before update on public.accommodations
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 4. Trip-date-range trigger (defense-in-depth, AC-2)
--    Postgres CHECK constraints cannot reference other tables; we enforce
--    "dates inside trip" via a BEFORE INSERT/UPDATE trigger that reads the
--    parent `trips` row.
-- ============================================================================

create or replace function public.tg_accommodation_within_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s date;
  e date;
begin
  select start_date, end_date into s, e
    from public.trips
    where id = new.trip_id;

  if s is null then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if new.check_in_date < s or new.check_in_date > e then
    raise exception 'check_in_out_of_range'
      using errcode = '23514',
            detail  = format('check_in_date %s outside trip range %s..%s',
                             new.check_in_date, s, e);
  end if;

  if new.check_out_date < s or new.check_out_date > e then
    raise exception 'check_out_out_of_range'
      using errcode = '23514',
            detail  = format('check_out_date %s outside trip range %s..%s',
                             new.check_out_date, s, e);
  end if;

  return new;
end
$$;

create trigger accommodations_within_trip
  before insert or update on public.accommodations
  for each row execute function public.tg_accommodation_within_trip();

-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table public.accommodations enable row level security;

create policy accommodations_select on public.accommodations
  for select using (public.is_trip_member(trip_id, 'viewer'));

create policy accommodations_insert on public.accommodations
  for insert with check (public.is_trip_member(trip_id, 'editor'));

create policy accommodations_update on public.accommodations
  for update using (public.is_trip_member(trip_id, 'editor'));

create policy accommodations_delete on public.accommodations
  for delete using (public.is_trip_member(trip_id, 'editor'));

-- ============================================================================
-- 6. View — per-day accommodation indicators (single batched read; no N+1)
--    `security_invoker = true` (Postgres 15+) means the view runs with the
--    caller's RLS, so the underlying `trip_days` + `accommodations` policies
--    do the isolation work; no policy needs to be defined on the view.
-- ============================================================================

create view public.trip_day_accommodation_indicators
with (security_invoker = true) as
select
  d.trip_id                 as trip_id,
  d.id                      as trip_day_id,
  d.date                    as day_date,
  a.id                      as accommodation_id,
  coalesce(a.hotel_name, p.name) as hotel_name,
  a.place_id                as place_id,
  case
    when d.date = a.check_in_date and d.date = a.check_out_date then 'same_day'
    when d.date = a.check_in_date  then 'check_in'
    when d.date = a.check_out_date then 'check_out'
    else 'in_stay'
  end                       as indicator_type
from public.trip_days d
join public.accommodations a
  on a.trip_id = d.trip_id
  and d.date between a.check_in_date and a.check_out_date
left join public.places p on p.id = a.place_id;

commit;
