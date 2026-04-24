-- 0001_init.sql  |  Sprint 1  |  2026-04-24
-- Tables: profiles, trips, trip_members, trip_invitations, trip_days, itinerary_items
-- Functions: is_trip_member, tg_set_updated_at, tg_seed_owner_member
-- Extension: pgcrypto
-- Rollback: see end of file
--
-- Ordering:
--   1. Extensions
--   2. All tables (no policies, no triggers yet) — establishes referential relationships
--   3. Functions — can now reference tables safely
--   4. Triggers — depend on functions
--   5. Policies — depend on is_trip_member()

begin;

-- ============================================================================
-- 1. Extensions
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 2. Tables (structure only)
-- ============================================================================

-- 2.1 profiles — extends auth.users
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

-- 2.2 trips
create table public.trips (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  name              text not null check (length(name) between 1 and 120),
  start_date        date not null,
  end_date          date not null,
  destination       text,
  cover_image_url   text,
  base_currency     char(3) not null default 'EUR'
                      check (base_currency ~ '^[A-Z]{3}$'),
  total_budget      numeric(14,2) check (total_budget is null or total_budget >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint trips_dates_valid check (end_date >= start_date)
);
create index trips_owner_idx on public.trips (owner_id);
create index trips_start_date_idx on public.trips (start_date);

-- 2.3 trip_members
create table public.trip_members (
  trip_id      uuid not null references public.trips(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner','editor','viewer')),
  status       text not null default 'pending'
                  check (status in ('pending','accepted','revoked')),
  invited_by   uuid references auth.users(id) on delete set null,
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (trip_id, user_id)
);
create index trip_members_user_idx on public.trip_members (user_id);
create index trip_members_trip_idx on public.trip_members (trip_id);

-- 2.4 trip_invitations
create table public.trip_invitations (
  id                   uuid primary key default gen_random_uuid(),
  trip_id              uuid not null references public.trips(id) on delete cascade,
  email                text not null,
  role                 text not null check (role in ('editor','viewer')),
  token                text not null unique,
  expires_at           timestamptz not null,
  created_by           uuid not null references auth.users(id) on delete cascade,
  accepted_by_user_id  uuid references auth.users(id) on delete set null,
  accepted_at          timestamptz,
  created_at           timestamptz not null default now()
);
create index trip_invitations_trip_idx  on public.trip_invitations (trip_id);
create index trip_invitations_email_idx on public.trip_invitations (lower(email));
create index trip_invitations_token_idx on public.trip_invitations (token);

-- 2.5 trip_days
create table public.trip_days (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  day_number  integer not null check (day_number >= 1),
  date        date not null,
  title       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (trip_id, day_number),
  unique (trip_id, date)
);
create index trip_days_trip_idx on public.trip_days (trip_id, day_number);

-- 2.6 itinerary_items
-- Sprint 1 ships WITHOUT place_id FK; Sprint 2 adds the places table + FK.
create table public.itinerary_items (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  day_id       uuid references public.trip_days(id) on delete set null,
  type         text not null check (type in ('transport','lodging','activity','meal','note')),
  start_time   timestamptz,
  end_time     timestamptz,
  title        text not null check (length(title) between 1 and 200),
  external_url text,
  notes        text,
  cost         numeric(14,2) check (cost is null or cost >= 0),
  currency     char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint itinerary_items_time_order
    check (start_time is null or end_time is null or end_time >= start_time)
);
create index itinerary_items_trip_idx on public.itinerary_items (trip_id);
create index itinerary_items_day_idx  on public.itinerary_items (day_id);
create index itinerary_items_type_idx on public.itinerary_items (type);

-- ============================================================================
-- 3. Functions (tables now exist, so bodies resolve)
-- ============================================================================

-- Membership helper used in every trip-scoped policy.
create or replace function public.is_trip_member(
  p_trip_id uuid,
  p_min_role text default 'viewer'
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = p_trip_id
      and user_id = auth.uid()
      and status  = 'accepted'
      and case p_min_role
            when 'owner'  then role = 'owner'
            when 'editor' then role in ('owner','editor')
            else true
          end
  );
$$;

-- Generic updated_at trigger.
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Seed creator as owner-member after trips insert.
create or replace function public.tg_seed_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members(trip_id, user_id, role, status, invited_by, accepted_at)
  values (new.id, new.owner_id, 'owner', 'accepted', new.owner_id, now())
  on conflict do nothing;
  return new;
end
$$;

-- ============================================================================
-- 4. Triggers
-- ============================================================================

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.tg_set_updated_at();

create trigger trips_seed_owner_member
  after insert on public.trips
  for each row execute function public.tg_seed_owner_member();

create trigger trip_days_set_updated_at
  before update on public.trip_days
  for each row execute function public.tg_set_updated_at();

create trigger itinerary_items_set_updated_at
  before update on public.itinerary_items
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 5. Row Level Security
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.trips            enable row level security;
alter table public.trip_members     enable row level security;
alter table public.trip_invitations enable row level security;
alter table public.trip_days        enable row level security;
alter table public.itinerary_items  enable row level security;

-- 5.1 profiles
create policy profiles_select_self on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from public.trip_members m_self
      join public.trip_members m_other
        on m_self.trip_id = m_other.trip_id
      where m_self.user_id  = auth.uid()
        and m_self.status   = 'accepted'
        and m_other.user_id = profiles.id
        and m_other.status  = 'accepted'
    )
  );

create policy profiles_insert_self on public.profiles
  for insert with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update using (id = auth.uid());

-- 5.2 trips
create policy trips_select on public.trips
  for select using (public.is_trip_member(id, 'viewer'));

create policy trips_insert on public.trips
  for insert with check (owner_id = auth.uid());

create policy trips_update on public.trips
  for update using (public.is_trip_member(id, 'editor'));

create policy trips_delete on public.trips
  for delete using (public.is_trip_member(id, 'owner'));

-- 5.3 trip_members
create policy trip_members_select on public.trip_members
  for select using (
    user_id = auth.uid() or public.is_trip_member(trip_id, 'viewer')
  );

create policy trip_members_insert on public.trip_members
  for insert with check (
    public.is_trip_member(trip_id, 'owner')
    or user_id = auth.uid()
  );

create policy trip_members_update on public.trip_members
  for update using (public.is_trip_member(trip_id, 'owner'));

create policy trip_members_delete on public.trip_members
  for delete using (
    public.is_trip_member(trip_id, 'owner')
    or user_id = auth.uid()
  );

-- 5.4 trip_invitations
create policy trip_invitations_select on public.trip_invitations
  for select using (public.is_trip_member(trip_id, 'owner'));

create policy trip_invitations_insert on public.trip_invitations
  for insert with check (
    public.is_trip_member(trip_id, 'owner') and created_by = auth.uid()
  );

create policy trip_invitations_update on public.trip_invitations
  for update using (public.is_trip_member(trip_id, 'owner'));

create policy trip_invitations_delete on public.trip_invitations
  for delete using (public.is_trip_member(trip_id, 'owner'));

-- 5.5 trip_days
create policy trip_days_select on public.trip_days
  for select using (public.is_trip_member(trip_id, 'viewer'));

create policy trip_days_insert on public.trip_days
  for insert with check (public.is_trip_member(trip_id, 'editor'));

create policy trip_days_update on public.trip_days
  for update using (public.is_trip_member(trip_id, 'editor'));

create policy trip_days_delete on public.trip_days
  for delete using (public.is_trip_member(trip_id, 'editor'));

-- 5.6 itinerary_items
create policy itinerary_items_select on public.itinerary_items
  for select using (public.is_trip_member(trip_id, 'viewer'));

create policy itinerary_items_insert on public.itinerary_items
  for insert with check (public.is_trip_member(trip_id, 'editor'));

create policy itinerary_items_update on public.itinerary_items
  for update using (public.is_trip_member(trip_id, 'editor'));

create policy itinerary_items_delete on public.itinerary_items
  for delete using (public.is_trip_member(trip_id, 'editor'));

commit;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- begin;
-- drop table if exists public.itinerary_items   cascade;
-- drop table if exists public.trip_days         cascade;
-- drop table if exists public.trip_invitations  cascade;
-- drop table if exists public.trip_members      cascade;
-- drop table if exists public.trips             cascade;
-- drop table if exists public.profiles          cascade;
-- drop function if exists public.tg_seed_owner_member();
-- drop function if exists public.tg_set_updated_at();
-- drop function if exists public.is_trip_member(uuid, text);
-- -- pgcrypto left in place intentionally.
-- commit;
