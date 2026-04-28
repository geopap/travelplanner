-- 0012_expenses.sql  |  Sprint 4  |  B-014 — Budget & expenses
--
-- Creates the `expenses` table for tracking trip expenditure against the
-- per-trip `trips.total_budget` (already present in 0001_init.sql), plus the
-- SQL function `get_trip_balances` used by `GET /api/trips/[id]/balances`
-- to compute per-member paid/owes/net in a single round-trip (no N+1).
--
-- Refinements vs SOLUTION_DESIGN.md §2.11:
--   - `paid_by` references `public.profiles(id) on delete set null` (R3 spec
--     correction — `not null` + `set null` is incoherent, so column is
--     NULLABLE; matches `created_by` pattern from accommodations §2.9).
--   - `created_by` likewise references `public.profiles(id) on delete set null`
--     (instead of `auth.users`) for parity with bookmarks/accommodations
--     pattern; cascade behavior is identical because `profiles.id` is FK to
--     `auth.users.id` with cascade.
--
-- Reuses helpers from 0001_init.sql:
--   - public.is_trip_member(uuid, text)
--   - public.tg_set_updated_at()
--
-- ROLLBACK: see 0012_expenses_rollback.sql.

begin;

-- ============================================================================
-- 1. Table
-- ============================================================================

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  category     text not null check (category in (
                 'accommodation','transport','food','activities','shopping','other'
               )),
  description  text not null check (char_length(description) between 1 and 500),
  amount       numeric(12,2) not null check (amount > 0),
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  occurred_at  date not null,
  paid_by      uuid references public.profiles(id) on delete set null,
  split_among  jsonb not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint expenses_split_among_shape
    check (
      jsonb_typeof(split_among) = 'array'
      and jsonb_array_length(split_among) >= 1
    )
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

create index expenses_trip_occurred_idx
  on public.expenses (trip_id, occurred_at desc);

create index expenses_paid_by_idx
  on public.expenses (trip_id, paid_by);

-- ============================================================================
-- 3. updated_at trigger (reuses 0001_init.sql tg_set_updated_at())
-- ============================================================================

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 4. Trip-date-range trigger (defense-in-depth, AC-5)
--    Postgres CHECK constraints cannot reference other tables; we enforce
--    "occurred_at inside trip" via a BEFORE INSERT/UPDATE trigger that reads
--    the parent `trips` row. Mirrors `tg_accommodation_within_trip` from 0009.
-- ============================================================================

create or replace function public.tg_expense_within_trip()
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

  if new.occurred_at < s or new.occurred_at > e then
    raise exception 'occurred_at_out_of_range'
      using errcode = '23514',
            detail  = format('occurred_at %s outside trip range %s..%s',
                             new.occurred_at, s, e);
  end if;

  return new;
end
$$;

create trigger expenses_within_trip
  before insert or update on public.expenses
  for each row execute function public.tg_expense_within_trip();

-- ============================================================================
-- 5. RLS
-- ============================================================================

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select using (public.is_trip_member(trip_id, 'viewer'));

create policy expenses_insert on public.expenses
  for insert with check (public.is_trip_member(trip_id, 'editor'));

create policy expenses_update on public.expenses
  for update using (public.is_trip_member(trip_id, 'editor'));

create policy expenses_delete on public.expenses
  for delete using (public.is_trip_member(trip_id, 'editor'));

-- ============================================================================
-- 6. Per-trip balance RPC — get_trip_balances(p_trip_id)
--
-- `security invoker`: caller's RLS on `trip_members` and `expenses` controls
-- visibility. Non-members get an empty result set (RLS denies the underlying
-- selects, so `members`/`paid_per_member`/`shares` all yield zero rows).
--
-- Returns one row per accepted trip member, with paid/owes/net in
-- `trips.base_currency` (v1: API enforces all expenses share that currency).
-- ============================================================================

create or replace function public.get_trip_balances(p_trip_id uuid)
returns table (
  user_id   uuid,
  paid      numeric(14,2),
  owes      numeric(14,2),
  net       numeric(14,2)
)
language sql
stable
security invoker
set search_path = public
as $$
  with members as (
    select tm.user_id
    from public.trip_members tm
    where tm.trip_id = p_trip_id
      and tm.status = 'accepted'
  ),
  paid_per_member as (
    select e.paid_by as user_id, coalesce(sum(e.amount), 0) as paid
    from public.expenses e
    where e.trip_id = p_trip_id
      and e.paid_by is not null
    group by e.paid_by
  ),
  shares as (
    select
      (s->>'user_id')::uuid                                  as user_id,
      sum(e.amount * ((s->>'share_pct')::numeric) / 100.0)   as owes
    from public.expenses e
    cross join lateral jsonb_array_elements(e.split_among) s
    where e.trip_id = p_trip_id
    group by (s->>'user_id')::uuid
  )
  select
    m.user_id,
    coalesce(p.paid, 0)::numeric(14,2)                            as paid,
    coalesce(sh.owes, 0)::numeric(14,2)                           as owes,
    (coalesce(p.paid, 0) - coalesce(sh.owes, 0))::numeric(14,2)   as net
  from members m
  left join paid_per_member p  on p.user_id  = m.user_id
  left join shares          sh on sh.user_id = m.user_id;
$$;

revoke all on function public.get_trip_balances(uuid) from public;
grant execute on function public.get_trip_balances(uuid) to authenticated;

commit;
