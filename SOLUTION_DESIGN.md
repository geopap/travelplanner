# TravelPlanner — Solution Design

**Version:** 1.0
**Date:** 2026-04-24
**Owner:** [solution-architect]
**Status:** Baseline (Sprint 0) — source of truth for DB schema, RLS, API contracts, and security model.

---

## 1. Project Structure

```
/Users/george/travelplanner/
├── CLAUDE.md                      # Agent rules + 8-round pipeline
├── SPRINT.md · BACKLOG.md · BACKLOG_BOARD.md
├── SPRINT_ARCHIVE.md · SPRINT_FINDINGS.md
├── PRD.md · BUSINESS_PLAN.md
├── MARKETING_PLAN.md · STRATEGIC_PLAN.md
├── SOLUTION_DESIGN.md             # (this file)
├── RELEASES.md · CONTRIBUTING.md
├── agents/*.md                    # 17 agent definitions
├── docs/user-manual/              # End-user documentation (technical-writer)
└── app/                           # Next.js 16 application
    ├── src/
    │   ├── app/
    │   │   ├── (auth)/            # /sign-in, /sign-up, /forgot-password
    │   │   ├── invitations/[token]/  # public invite-accept screen
    │   │   ├── trips/             # /trips, /trips/new, /trips/[id]/...
    │   │   │   └── [id]/
    │   │   │       ├── page.tsx          # overview
    │   │   │       ├── itinerary/
    │   │   │       ├── transportation/
    │   │   │       ├── accommodations/
    │   │   │       ├── places/           # bookmarks
    │   │   │       ├── budget/           # expenses
    │   │   │       └── members/
    │   │   ├── account/           # profile, GDPR export/delete
    │   │   └── api/               # App Router server routes (see §4)
    │   ├── components/            # UI components (see §5)
    │   ├── lib/
    │   │   ├── supabase/          # server + browser clients, Database types
    │   │   ├── types/             # Domain TS types (Trip, TripMember, …)
    │   │   ├── validations/       # Zod schemas per resource
    │   │   ├── hooks/             # Custom React hooks
    │   │   ├── utils/             # Formatters (dates, currency, ISO-4217)
    │   │   ├── google-places/     # Server-side Places client + cache helper
    │   │   └── ai/                # RESERVED — empty in v1 (Phase C)
    │   └── __tests__/             # Unit + integration tests (Jest/Vitest)
    ├── e2e/                       # Playwright tests + POM
    ├── supabase/
    │   └── migrations/            # 0001_init.sql, 0002_*, …
    ├── scripts/
    │   └── import-trello.ts       # Japan 2026 seed import (idempotent)
    └── public/
```

**Reserved paths** — `app/src/lib/ai/` stays empty in v1. It is reserved for Phase C (AI itinerary suggestions, expense OCR, budget forecasts) and owned by [ai-ml-engineer].

## 2. Database Schema

All tables live in `public`. Every table has RLS enabled and uses `auth.uid()` via Supabase. UUIDs are generated with `gen_random_uuid()` (pgcrypto). `created_at` / `updated_at` are `timestamptz DEFAULT now()`.

### 2.0 Extensions, helper function, trigger

```sql
create extension if not exists "pgcrypto";

-- Membership helper used in every trip-scoped policy.
-- Returns TRUE iff auth.uid() is an accepted member of p_trip_id with
-- at least p_min_role ('viewer' | 'editor' | 'owner').
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

-- Generic updated_at trigger
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
```

### 2.1 `profiles` — extends `auth.users`

```sql
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

alter table public.profiles enable row level security;

-- A user can read any profile that shares a trip with them (needed for members list);
-- for simplicity v1 restricts SELECT to the same user + profiles of co-members.
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
-- DELETE: handled by auth.users cascade; no direct policy.
```

### 2.2 `trips`

```sql
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
create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.tg_set_updated_at();

alter table public.trips enable row level security;

create policy trips_select on public.trips
  for select using (public.is_trip_member(id, 'viewer'));
-- Creator must be the inserting user; membership row is seeded by trigger/route.
create policy trips_insert on public.trips
  for insert with check (owner_id = auth.uid());
create policy trips_update on public.trips
  for update using (public.is_trip_member(id, 'editor'));
create policy trips_delete on public.trips
  for delete using (public.is_trip_member(id, 'owner'));

-- Auto-seed the creator as owner-member.
create or replace function public.tg_seed_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members(trip_id, user_id, role, status, invited_by, accepted_at)
  values (new.id, new.owner_id, 'owner', 'accepted', new.owner_id, now())
  on conflict do nothing;
  return new;
end $$;
create trigger trips_seed_owner_member
  after insert on public.trips
  for each row execute function public.tg_seed_owner_member();
```

### 2.3 `trip_members`

```sql
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

alter table public.trip_members enable row level security;

create policy trip_members_select on public.trip_members
  for select using (
    user_id = auth.uid() or public.is_trip_member(trip_id, 'viewer')
  );
-- Only owner adds members; INSERT usually happens via API from the invitation
-- accept flow (auth.uid() becomes the new member).
create policy trip_members_insert on public.trip_members
  for insert with check (
    public.is_trip_member(trip_id, 'owner')
    or user_id = auth.uid()  -- self-acceptance via invitation
  );
create policy trip_members_update on public.trip_members
  for update using (public.is_trip_member(trip_id, 'owner'));
create policy trip_members_delete on public.trip_members
  for delete using (
    public.is_trip_member(trip_id, 'owner')
    or user_id = auth.uid()  -- a member may remove themselves
  );
```

### 2.4 `trip_invitations`

```sql
create table public.trip_invitations (
  id                   uuid primary key default gen_random_uuid(),
  trip_id              uuid not null references public.trips(id) on delete cascade,
  email                text not null,
  role                 text not null check (role in ('editor','viewer')),
  token                text not null unique,          -- 32+ bytes base64url, crypto-random
  expires_at           timestamptz not null,
  created_by           uuid not null references auth.users(id) on delete cascade,
  accepted_by_user_id  uuid references auth.users(id) on delete set null,
  accepted_at          timestamptz,
  created_at           timestamptz not null default now()
);
create index trip_invitations_trip_idx  on public.trip_invitations (trip_id);
create index trip_invitations_email_idx on public.trip_invitations (lower(email));

alter table public.trip_invitations enable row level security;

-- Token-based lookup is done via SECURITY DEFINER RPC (see §3.2); RLS for direct
-- table access is trip-owner-only.
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
```

### 2.5 `trip_days`

```sql
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
create trigger trip_days_set_updated_at
  before update on public.trip_days
  for each row execute function public.tg_set_updated_at();

alter table public.trip_days enable row level security;

create policy trip_days_select on public.trip_days
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy trip_days_insert on public.trip_days
  for insert with check (public.is_trip_member(trip_id, 'editor'));
create policy trip_days_update on public.trip_days
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy trip_days_delete on public.trip_days
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

### 2.6 `places` (Google Places cache, global)

```sql
create table public.places (
  id                uuid primary key default gen_random_uuid(),
  google_place_id   text not null unique,
  name              text not null,
  address           text,
  lat               double precision,
  lng               double precision,
  category          text,
  cached_details    jsonb not null default '{}'::jsonb,
  cached_at         timestamptz not null default now(),
  ttl_expires_at    timestamptz not null default (now() + interval '30 days')
);
create index places_google_id_idx on public.places (google_place_id);
create index places_category_idx  on public.places (category);
create index places_cached_details_gin on public.places using gin (cached_details);

alter table public.places enable row level security;

-- Cache is shared across all authenticated users; writes happen only from the
-- service role via the /api/places/* proxy, so no INSERT/UPDATE/DELETE policies
-- are granted to authenticated users.
create policy places_select_authenticated on public.places
  for select to authenticated using (true);
```

### 2.7 `itinerary_items`

```sql
create table public.itinerary_items (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  day_id       uuid references public.trip_days(id) on delete set null,
  type         text not null check (type in ('transport','lodging','activity','meal','note')),
  start_time   timestamptz,
  end_time     timestamptz,
  title        text not null check (length(title) between 1 and 200),
  place_id     uuid references public.places(id) on delete set null,
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
create index itinerary_items_trip_idx  on public.itinerary_items (trip_id);
create index itinerary_items_day_idx   on public.itinerary_items (day_id);
create index itinerary_items_place_idx on public.itinerary_items (place_id);
create trigger itinerary_items_set_updated_at
  before update on public.itinerary_items
  for each row execute function public.tg_set_updated_at();

alter table public.itinerary_items enable row level security;

create policy itinerary_items_select on public.itinerary_items
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy itinerary_items_insert on public.itinerary_items
  for insert with check (public.is_trip_member(trip_id, 'editor'));
create policy itinerary_items_update on public.itinerary_items
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy itinerary_items_delete on public.itinerary_items
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

### 2.8 `transportation`

```sql
create table public.transportation (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  day_id           uuid references public.trip_days(id) on delete set null,
  mode             text not null check (mode in ('flight','train','bus','car','ferry')),
  carrier          text,
  booking_ref      text,
  departure_time   timestamptz,
  arrival_time     timestamptz,
  from_location    text,
  to_location      text,
  from_place_id    uuid references public.places(id) on delete set null,
  to_place_id      uuid references public.places(id) on delete set null,
  cost             numeric(14,2) check (cost is null or cost >= 0),
  currency         char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint transportation_time_order
    check (departure_time is null or arrival_time is null or arrival_time >= departure_time)
);
create index transportation_trip_idx on public.transportation (trip_id);
create index transportation_day_idx  on public.transportation (day_id);
create index transportation_depart_idx on public.transportation (departure_time);
create trigger transportation_set_updated_at
  before update on public.transportation
  for each row execute function public.tg_set_updated_at();

alter table public.transportation enable row level security;

create policy transportation_select on public.transportation
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy transportation_insert on public.transportation
  for insert with check (public.is_trip_member(trip_id, 'editor'));
create policy transportation_update on public.transportation
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy transportation_delete on public.transportation
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

### 2.9 `accommodations`

```sql
create table public.accommodations (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  place_id         uuid references public.places(id) on delete set null,
  name             text not null check (length(name) between 1 and 200),
  check_in_date    date not null,
  check_out_date   date not null,
  booking_ref      text,
  cost_per_night   numeric(14,2) check (cost_per_night is null or cost_per_night >= 0),
  total_cost       numeric(14,2) check (total_cost is null or total_cost >= 0),
  currency         char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint accommodations_dates_valid check (check_out_date >= check_in_date)
);
create index accommodations_trip_idx  on public.accommodations (trip_id);
create index accommodations_place_idx on public.accommodations (place_id);
create trigger accommodations_set_updated_at
  before update on public.accommodations
  for each row execute function public.tg_set_updated_at();

alter table public.accommodations enable row level security;

create policy accommodations_select on public.accommodations
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy accommodations_insert on public.accommodations
  for insert with check (public.is_trip_member(trip_id, 'editor'));
create policy accommodations_update on public.accommodations
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy accommodations_delete on public.accommodations
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

### 2.10 `bookmarks`

```sql
create table public.bookmarks (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  place_id    uuid not null references public.places(id) on delete cascade,
  category    text not null check (category in ('restaurant','sight','museum','shopping','other')),
  notes       text,
  added_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (trip_id, place_id, category)
);
create index bookmarks_trip_idx     on public.bookmarks (trip_id);
create index bookmarks_place_idx    on public.bookmarks (place_id);
create index bookmarks_category_idx on public.bookmarks (trip_id, category);

alter table public.bookmarks enable row level security;

create policy bookmarks_select on public.bookmarks
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy bookmarks_insert on public.bookmarks
  for insert with check (public.is_trip_member(trip_id, 'editor') and added_by = auth.uid());
create policy bookmarks_update on public.bookmarks
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy bookmarks_delete on public.bookmarks
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

### 2.11 `expenses` — REFINED Sprint 4 R2 (B-014)

Migration: `app/supabase/migrations/0012_expenses.sql` (rollback: `0012_expenses_rollback.sql`).
`trips.total_budget` already exists in baseline `0001_init.sql` (numeric(14,2), nullable, in `trips.base_currency`) — no separate migration required.

**Refinements vs Sprint-0 draft:**
- `description` is now `not null` (per AC-2; required form field).
- `amount` is now strictly positive (`> 0`, not `>= 0`) — refunds/credits out of v1 scope.
- `occurred_at` changed from `timestamptz` to `date` — AC-2 specifies a calendar date that must fall inside `trips.start_date..end_date` (also `date`). No time-of-day need for v1.
- Added `created_by` column (parallel to accommodations pattern §2.9; supports audit & "added by" UI).
- Added shape CHECK on `split_among` (must be a JSON array with ≥ 1 element).
- Replaced legacy `expenses_occurred_idx` with `(trip_id, occurred_at desc)` to back the descending list query (AC-7).
- Added a per-trip date-range trigger (mirrors `tg_accommodation_within_trip` in 0009) — defense-in-depth for AC-5; API still validates first to return clean 400s.
- `day_id` retained as nullable convenience column (joinable to `trip_days`); not required by AC. Indexed (partial).

```sql
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  day_id       uuid references public.trip_days(id) on delete set null,
  category     text not null check (category in (
                 'accommodation','transport','food','activities','shopping','other'
               )),
  description  text not null check (char_length(description) between 1 and 500),
  amount       numeric(12,2) not null check (amount > 0),
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  occurred_at  date not null,
  paid_by      uuid not null references auth.users(id) on delete set null,
  split_among  jsonb not null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint expenses_split_among_shape
    check (
      jsonb_typeof(split_among) = 'array'
      and jsonb_array_length(split_among) >= 1
    )
);

create index expenses_trip_occurred_idx on public.expenses (trip_id, occurred_at desc);
create index expenses_day_idx           on public.expenses (day_id) where day_id is not null;
create index expenses_paid_by_idx       on public.expenses (trip_id, paid_by);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.tg_set_updated_at();

-- Per-trip date-range trigger (defense-in-depth; mirrors 0009 accommodations)
create or replace function public.tg_expense_within_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s date; e date;
begin
  select start_date, end_date into s, e from public.trips where id = new.trip_id;
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

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy expenses_insert on public.expenses
  for insert with check (public.is_trip_member(trip_id, 'editor'));
create policy expenses_update on public.expenses
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy expenses_delete on public.expenses
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

**`split_among` shape (API-validated, not DB-enforced):**

```json
[ { "user_id": "uuid", "share_pct": 50 }, { "user_id": "uuid", "share_pct": 50 } ]
```

API rules (validated in `app/src/lib/validations/expense.ts`):
1. Each `user_id` must be a current accepted member of the trip.
2. `user_id` values are unique within the array.
3. `share_pct` values sum to exactly `100` (allow ±0.01 tolerance for rounding) — for v1 EQUAL split (AC-3) all shares are `100 / count`.
4. `paid_by` must also be a current accepted member of the trip.
5. `currency` must equal `trips.base_currency` (AC-2; multi-currency deferred to Phase B).

A DB CHECK that sums `share_pct` across array elements would require a cumbersome LATERAL — over-complex for v1. The trigger above already enforces the date constraint; per-share validation lives at the API layer where errors are user-friendly.

**Net balance — `get_trip_balances` SQL function**

To avoid N+1 (one query per member) the balance computation lives in a single SQL function called by `GET /api/trips/[id]/balances` and embedded in the trip overview when needed.

```sql
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
    select user_id
    from public.trip_members
    where trip_id = p_trip_id and accepted_at is not null
  ),
  paid_per_member as (
    select e.paid_by as user_id, coalesce(sum(e.amount), 0) as paid
    from public.expenses e
    where e.trip_id = p_trip_id
    group by e.paid_by
  ),
  -- Unnest split_among once; share_amount = amount * share_pct / 100.
  shares as (
    select
      (s->>'user_id')::uuid                                     as user_id,
      sum(e.amount * ((s->>'share_pct')::numeric) / 100.0)      as owes
    from public.expenses e
    cross join lateral jsonb_array_elements(e.split_among) s
    where e.trip_id = p_trip_id
    group by (s->>'user_id')::uuid
  )
  select
    m.user_id,
    coalesce(p.paid, 0)::numeric(14,2)                  as paid,
    coalesce(sh.owes, 0)::numeric(14,2)                 as owes,
    (coalesce(p.paid, 0) - coalesce(sh.owes, 0))::numeric(14,2) as net
  from members m
  left join paid_per_member p on p.user_id = m.user_id
  left join shares          sh on sh.user_id = m.user_id;
$$;
-- Restrict execution: function is `security invoker`, so the caller's RLS on
-- `trip_members` and `expenses` controls visibility. Non-members see no rows
-- (RLS denies the underlying selects).
revoke all on function public.get_trip_balances(uuid) from public;
grant execute on function public.get_trip_balances(uuid) to authenticated;
```

The API route joins this output with `profiles` (single batched query: `select profiles.id, full_name, email from profiles where id in (...)`) and returns `[{ user_id, full_name, email, paid, owes, net }]` sorted by `net desc`. **One DB round-trip for balances + one for profile names — no N+1.**

### 2.12 `audit_log` (mutations across all trip-scoped tables)

```sql
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,        -- 'insert' | 'update' | 'delete' | custom verb
  entity      text not null,        -- table name
  entity_id   uuid,
  trip_id     uuid,
  metadata    jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index audit_log_trip_idx  on public.audit_log (trip_id, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

alter table public.audit_log enable row level security;

-- Only trip owners can read the log for their trip. Writes are performed from
-- the service role (inside API routes), never directly by the client.
create policy audit_log_select on public.audit_log
  for select using (
    trip_id is not null and public.is_trip_member(trip_id, 'owner')
  );
```

## 3. Security Architecture

### 3.1 Authentication
- **v1:** Supabase Auth email/password with email verification. Session cookies via `@supabase/ssr` (HTTP-only, Secure, SameSite=Lax).
- **Phase B:** OAuth providers — Google and Apple — added behind the same Supabase Auth layer. No schema change required.
- Password reset: Supabase-managed flow, `/forgot-password` + `/reset-password` pages.
- **Defense-in-depth:** every API route calls `supabase.auth.getUser()` server-side before any DB work; anonymous requests are rejected with 401.

### 3.2 Authorization — role matrix

| Capability | viewer | editor | owner |
|---|:-:|:-:|:-:|
| Read trip + all child resources | ✔ | ✔ | ✔ |
| Create/update/delete itinerary items, transportation, accommodations, bookmarks, expenses, trip_days | — | ✔ | ✔ |
| Update trip name / dates / destination / budget / cover image | — | — | ✔ |
| Invite / revoke members, change roles | — | — | ✔ |
| Delete trip | — | — | ✔ |
| Leave trip (delete self from `trip_members`) | ✔ | ✔ | ✔¹ |
| Read audit log | — | — | ✔ |

¹ Owner may leave only if another owner exists — enforced in `/api/trips/[id]/members` DELETE.

**Invitation token flow** — tokens are 32 bytes of `crypto.randomBytes`, base64url-encoded; single-use (acceptance sets `accepted_by_user_id` and `accepted_at`); expire in 7 days; looked up via `rpc('accept_trip_invitation', { p_token })` which runs as `security definer` so the table does not need a permissive read policy.

**Never trust client `trip_id`** — every API route derives `trip_id` from the URL path and verifies membership via `is_trip_member` before mutating.

### 3.3 Compliance
- **GDPR self-service**
  - `GET /api/me` returns a bundled JSON export of: profile, trips where user is a member, all child rows the user can read, bookmarks, expenses.
  - `DELETE /api/me` invokes an edge function (`delete_user_cascade`) that deletes the `auth.users` row; `ON DELETE CASCADE` propagates through `profiles`, `trip_members`, and trip ownership. For trips where the user is the sole owner, ownership is transferred to the oldest remaining accepted editor (promoted to owner); if none, the trip is deleted.
- **Google Places attribution** — place detail pages display the "Powered by Google" logo and (where present) `html_attributions`. Cached payloads respect Google's 30-day max-TTL for Place Details; Autocomplete suggestions are session-scoped and never persisted.
- **PII / logging** — never log emails, tokens, or payment amounts. Structured logs redact `Authorization`, `Cookie`, `email`, `token`.
- **Audit log** — every API mutation writes one `audit_log` row via a shared `logAudit(actor, action, entity, entityId, tripId, metadata)` helper (service-role client).

## 4. API Contracts

All routes live under `app/src/app/api/`. All return `application/json`. All mutating routes require an authenticated Supabase session cookie; absence → `401`. Path params are validated with Zod. Every list endpoint accepts `page` (default 1) and `limit` (default 20, max 100) — **this satisfies R2 Q-3 across every list route**.

Standard error envelope:
```json
{ "error": { "code": "string", "message": "human readable", "details": {} } }
```
Standard status codes: `400` (validation), `401` (unauthenticated), `403` (not a member / insufficient role), `404` (not found or not a member — both return 404 to avoid leaking existence), `409` (conflict), `429` (rate limit), `500` (server).

### 4.1 Zod schema conventions (`app/src/lib/validations/`)

```ts
export const UuidSchema     = z.string().uuid();
export const IsoDateSchema  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const Iso4217Schema  = z.string().regex(/^[A-Z]{3}$/);
export const PageSchema     = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

### 4.2 Trips

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips` | any member | query: `page`, `limit`, optional `q` | `{ items: Trip[], page, limit, total }` | 401 |
| POST | `/api/trips` | authenticated | `{ name, start_date, end_date, destination?, base_currency, total_budget?, cover_image_url? }` | `201 { trip: Trip }` | 400, 401 |
| GET | `/api/trips/[id]` | viewer+ | — | `{ trip: Trip, member: TripMember }` | 401, 404 |
| PATCH | `/api/trips/[id]` | owner | partial Trip | `{ trip: Trip }` | 400, 403, 404 |
| DELETE | `/api/trips/[id]` | owner | — | `204` | 403, 404 |

```ts
export const TripCreate = z.object({
  name: z.string().min(1).max(120),
  start_date: IsoDateSchema,
  end_date:   IsoDateSchema,
  destination: z.string().max(200).optional(),
  base_currency: Iso4217Schema,
  total_budget:  z.number().nonnegative().optional(),
  cover_image_url: z.string().url().optional(),
}).refine(d => d.end_date >= d.start_date, { path: ['end_date'] });
```

### 4.3 Members & invitations

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/members` | viewer+ | `page`, `limit` | `{ items: (TripMember & { profile })[], total }` | 401, 404 |
| DELETE | `/api/trips/[id]/members?user_id=` | owner (or self) | — | `204` | 403, 404, 409 (last owner) |
| POST | `/api/trips/[id]/invitations` | owner | `{ email, role: 'editor'\|'viewer' }` | `201 { invitation }` | 400, 403, 404, 429 |
| GET | `/api/trips/[id]/invitations` | owner | `page`, `limit` | `{ items: Invitation[], total }` | 403, 404 |
| GET | `/api/invitations/[token]` | public | — | `{ trip_name, inviter_name, role, expires_at }` | 404 (invalid/expired) |
| POST | `/api/invitations/[token]` | authenticated | — | `200 { trip_id }` | 401, 404, 409 (already member) |

Invitation send is rate-limited to 10 invites/trip/hour and 30/user/hour.

### 4.4 Days

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/days` | viewer+ | `page`, `limit` | `{ items: TripDay[], total }` | 401, 404 |
| POST | `/api/trips/[id]/days` | editor+ | `{ regenerate: true }` | `{ items: TripDay[] }` (rebuilt from trip dates) | 403, 404, 409 |
| PATCH | `/api/trips/[id]/days/[dayId]` | editor+ | `{ title?, notes? }` | `{ day }` | 400, 403, 404 |

### 4.5 Itinerary items

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/items` | viewer+ | `page`, `limit`, optional `day_id`, `type` | `{ items, total }` | 401, 404 |
| POST | `/api/trips/[id]/items` | editor+ | `ItineraryItemCreate` | `201 { item }` | 400, 403, 404 |
| GET | `/api/trips/[id]/items/[itemId]` | viewer+ | — | `{ item }` | 404 |
| PATCH | `/api/trips/[id]/items/[itemId]` | editor+ | partial | `{ item }` | 400, 403, 404 |
| DELETE | `/api/trips/[id]/items/[itemId]` | editor+ | — | `204` | 403, 404 |

```ts
export const ItineraryItemCreate = z.object({
  day_id: UuidSchema.nullable().optional(),
  type:   z.enum(['transport','lodging','activity','meal','note']),
  start_time: z.string().datetime().optional(),
  end_time:   z.string().datetime().optional(),
  title:  z.string().min(1).max(200),
  place_id: UuidSchema.nullable().optional(),
  external_url: z.string().url().optional(),
  notes: z.string().max(5000).optional(),
  cost:  z.number().nonnegative().optional(),
  currency: Iso4217Schema.optional(),
}).refine(d => !d.start_time || !d.end_time || d.end_time >= d.start_time,
  { path: ['end_time'] });
```

### 4.6 Transportation

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/transportation` | viewer+ | `page`, `limit` | `{ items, total }` | 401, 404 |
| POST | `/api/trips/[id]/transportation` | editor+ | `TransportationCreate` | `201 { item }` | 400, 403, 404 |
| PATCH | `/api/trips/[id]/transportation/[id]` | editor+ | partial | `{ item }` | 400, 403, 404 |
| DELETE | `/api/trips/[id]/transportation/[id]` | editor+ | — | `204` | 403, 404 |

### 4.7 Accommodations

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/accommodations` | viewer+ | `page`, `limit` | `{ items, total }` | 401, 404 |
| POST | `/api/trips/[id]/accommodations` | editor+ | `AccommodationCreate` | `201 { item }` | 400, 403, 404 |
| PATCH | `/api/trips/[id]/accommodations/[id]` | editor+ | partial | `{ item }` | 400, 403, 404 |
| DELETE | `/api/trips/[id]/accommodations/[id]` | editor+ | — | `204` | 403, 404 |

### 4.8 Bookmarks

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/bookmarks` | viewer+ | `page`, `limit`, optional `category` | `{ items, total }` | 401, 404 |
| POST | `/api/trips/[id]/bookmarks` | editor+ | `{ place_id \| google_place_id, category, notes? }` | `201 { bookmark }` | 400, 403, 404, 409 |
| DELETE | `/api/trips/[id]/bookmarks/[id]` | editor+ | — | `204` | 403, 404 |

POST resolves `google_place_id → places.id` by hitting the cache (or cold-calling Place Details) before inserting.

### 4.9 Expenses — REFINED Sprint 4 R2 (B-014)

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/expenses` | viewer+ | `page` (default 1), `limit` (default 20, max 100), optional `category`, optional `paid_by` | `{ data: Expense[], page, limit, total, total_spent }` | 401, 403, 404 |
| GET | `/api/trips/[id]/expenses/[expenseId]` | viewer+ | — | `{ expense: Expense }` | 401, 403, 404 |
| POST | `/api/trips/[id]/expenses` | editor+ | `ExpenseCreate` | `201 { expense: Expense }` | 400, 401, 403, 404 |
| PATCH | `/api/trips/[id]/expenses/[expenseId]` | editor+ | partial `ExpenseCreate` | `{ expense: Expense }` | 400, 401, 403, 404 |
| DELETE | `/api/trips/[id]/expenses/[expenseId]` | editor+ | — | `204` | 401, 403, 404 |
| GET | `/api/trips/[id]/balances` | viewer+ | — | `{ balances: Balance[] }` (sorted by `net desc`) | 401, 403, 404 |

**`Expense` response shape:**
```ts
{
  id: string; trip_id: string; category: ExpenseCategory; description: string;
  amount: number; currency: string; occurred_at: string /* yyyy-mm-dd */;
  paid_by: string; paid_by_profile: { id: string; full_name: string | null; email: string };
  split_among: { user_id: string; share_pct: number }[];
  created_by: string | null; created_at: string; updated_at: string;
}
```

**`Balance` response shape:**
```ts
{ user_id: string; full_name: string | null; email: string;
  paid: number; owes: number; net: number; }
```

**`ExpenseCreate` (POST body):**
```ts
{
  category: 'accommodation'|'transport'|'food'|'activities'|'shopping'|'other';
  description: string;            // 1..500 chars
  amount: number;                 // > 0, max 2 decimals
  currency: string;               // ISO 4217 — must equal trip.base_currency
  occurred_at: string;            // yyyy-mm-dd, within trip date range
  paid_by: string;                // accepted trip member uuid
  split_among: { user_id: string; share_pct: number }[];  // see §2.11 rules
}
```

**Server-side validation (POST/PATCH) — every request:**
1. `is_trip_member(trip_id, 'editor')` (defense-in-depth, in addition to RLS).
2. `currency === trip.base_currency` → 400 `currency_must_match_base`.
3. `occurred_at` within `[trip.start_date, trip.end_date]` → 400 `date_out_of_range`. (DB trigger is the safety net.)
4. `paid_by` and every `split_among[].user_id` are accepted members of the trip — single query: `select user_id from trip_members where trip_id=$1 and accepted_at is not null and user_id = any($2::uuid[])`.
5. `split_among[].user_id` values unique; `share_pct` values sum to 100 ± 0.01.
6. `trip_id` always derived from URL — never read from request body.
7. Audit log row written via `logAudit('expense.create'|'expense.update'|'expense.delete', ...)` after success.

**List query — `GET /api/trips/[id]/expenses`** uses `expenses_trip_occurred_idx` (single ordered scan); joins `profiles` for `paid_by_profile` in one query (`.select('*, paid_by_profile:profiles!paid_by(id, full_name, email)')`). `total_spent` is a separate cheap aggregate `sum(amount)` over the trip (no pagination on it). No N+1.

**Balances query** — single RPC `supabase.rpc('get_trip_balances', { p_trip_id })` + single `profiles` lookup (`in` filter). RLS enforces visibility.

**Rationale — no DB cross-table currency check:** `expenses.currency` could be enforced equal to `trips.base_currency` via a trigger, but for v1 only `base_currency` is accepted by the API and refactoring around multi-currency in Phase B will naturally remove this constraint. API-layer validation is sufficient and yields cleaner errors.

### 4.10 Places proxy

| Method | Path | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/places/search` | authenticated | `q` (required), `session_token` (client-generated UUID) | `{ predictions: [{ description, place_id }] }` | 400, 401, 429 |
| GET | `/api/places/[google_place_id]` | authenticated | — | `{ place: Place }` (from cache if fresh, else upstream) | 401, 404, 429, 502 |

Server-side only. API key read from `GOOGLE_PLACES_API_KEY`. Rate limit: 20 autocomplete/minute and 60 details/minute per user. Details results upsert into `places` with `ttl_expires_at = now() + 30 days`.

### 4.11 Self / GDPR

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/me` | authenticated | `{ profile, trips, itinerary_items, transportation, accommodations, bookmarks, expenses, members }` — full personal export |
| PATCH | `/api/me` | authenticated | updated profile |
| DELETE | `/api/me` | authenticated | `202` — triggers cascade + ownership-transfer Edge Function |

## 5. Frontend Architecture

### 5.1 Pages tree (App Router, Next.js 16, React 19)

```
/                       marketing landing (public, minimal)
/sign-in · /sign-up · /forgot-password · /reset-password   (auth group)
/invitations/[token]                                       (public; requires sign-in to accept)
/account                profile + GDPR export/delete
/trips                  list of trips user is a member of
/trips/new              create-trip form
/trips/[id]             overview: summary, budget ring, next-up items, map
/trips/[id]/itinerary   day list + item editor
/trips/[id]/transportation
/trips/[id]/accommodations
/trips/[id]/places      bookmarks grouped by category
/trips/[id]/budget      expenses table + totals
/trips/[id]/members     member list + invite form
```

### 5.2 Key components (`app/src/components/`)
- `TripCard` — trip summary tile (used in `/trips`)
- `TripHeader` — name, dates, destination, role badge
- `BudgetRing` — SVG ring: spent vs budget, base-currency totals
- `ItineraryDayList` — virtualized list of days
- `ItineraryItemForm` — create/edit item; integrates `PlaceSearch`
- `ItineraryItemRow` — compact row display
- `TransportationForm`, `AccommodationForm`
- `PlaceSearch` — Google Autocomplete, debounced, uses per-session token
- `PlaceCard` — cached place details view (with attribution)
- `BookmarkList`, `BookmarkItem`
- `ExpenseTable` — sortable, filter by date/category
- `ExpenseForm` — split-among picker
- `MembersList` — role chips + revoke/leave actions
- `InviteForm`, `InvitationAccept` — invitation UX
- `LeafletDayMap` — react-leaflet map plotting items with coordinates for a given day
- `ConfirmDialog`, `EmptyState`, `SkeletonCard` — shared primitives
- `Toast` + `useToast` hook

### 5.3 State / data
- Server components fetch via `createServerClient` (Supabase SSR).
- Client components use `createBrowserClient` + lightweight fetch hooks (`useSWR`-style thin wrapper under `lib/hooks/`).
- Forms: React 19 `useActionState` + Zod validation.
- Loading state: **skeleton loaders**, never spinners. Empty states: icon + message + CTA. Destructive actions always prompt `ConfirmDialog`.

## 6. AI/ML Architecture — RESERVED

`app/src/lib/ai/` is intentionally empty in v1. Phase C candidates (not in scope until the Phase A + Phase B sprints close):

| Capability | Trigger | Primary model |
|---|---|---|
| Itinerary suggestions from destination + dates | user clicks "Suggest a day" | Claude Sonnet |
| Expense OCR from receipt photo | user uploads receipt | vision-capable model |
| Smart budget forecast | periodic re-compute | classical regression first, LLM fallback |
| Auto-categorize bookmarks from Place Details | on bookmark create | lightweight classifier |

All AI calls will be server-side proxied, rate-limited, and must never bypass the trip-membership checks defined in §3.2.

## 7. Performance Standards

Per CLAUDE.md plus TravelPlanner-specific targets:

| Metric | Target | Enforcement |
|---|---|---|
| API P95 latency | < 500 ms standard CRUD | [test-engineer] timing probe in CI |
| DB query | < 200 ms | [code-reviewer] flags missing index |
| Page LCP (mobile) | < 2.5 s | Lighthouse CI on preview deploys |
| List endpoint pagination | mandatory (`page`/`limit`) | R2 Q-3 gate |
| N+1 queries | forbidden | R2 Q-2 gate; [code-reviewer] CRITICAL |
| Date-bounded analytics | required for aggregations | R2 Q-4 gate |
| Google Places cache hit | < 50 ms | served from `places` table |
| Google Places **Details** TTL | 30 days | `ttl_expires_at` column |
| Google Places **Autocomplete** | session-only; never persisted | session_token param |

**R2 Query Performance Checklist compliance (baseline design):**
- Q-1 — All list queries use `.range((page-1)*limit, page*limit-1)` via shared helper.
- Q-2 — Trip detail page uses a single joined query (trip + member role + day count + expense totals view). No sequential per-row fetches.
- Q-3 — Every list route in §4 accepts `page`/`limit`.
- Q-4 — Expenses totals require `from`/`to` when requested; audit-log reads bounded by `trip_id` + default 30-day window.

## 8. Deployment Architecture

- **Hosting:** Vercel (Next.js 16 first-class), `develop` → Preview, `main` → Production.
- **Database + Auth:** Supabase cloud (single project in v1). Migrations applied via `supabase db push` from CI.
- **CI:** GitHub Actions workflow on every PR:
  1. `npm ci` · `npm run lint` · `tsc --noEmit`
  2. `npm test` (unit + integration)
  3. `npx playwright test` (e2e against an ephemeral Supabase branch)
  4. Vercel preview deploy URL posted back to PR
- **Secrets (Vercel env vars):**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server only)
  - `GOOGLE_PLACES_API_KEY` (server only; HTTP-referer unrestricted, key-restricted to Places)
  - `NEXT_PUBLIC_APP_URL` (for invitation email links)
- **Database migrations:** forward-only, one SQL file per change, numbered `NNNN_description.sql`. Every migration has a documented rollback in the Rollback Plans section.
- **Backups:** Supabase daily PITR (7-day retention in v1).

---

## Runbooks

*(populated per sprint — e.g., expired-invitation cleanup job, Google Places cache warmer)*

## Rollback Plans

*(populated per sprint — each migration ships with a forward + reverse SQL snippet)*

Sprint 1 baseline rollback (if `0001_init.sql` must be reverted):
```sql
drop table if exists public.audit_log cascade;
drop table if exists public.expenses cascade;
drop table if exists public.bookmarks cascade;
drop table if exists public.accommodations cascade;
drop table if exists public.transportation cascade;
drop table if exists public.itinerary_items cascade;
drop table if exists public.trip_days cascade;
drop table if exists public.places cascade;
drop table if exists public.trip_invitations cascade;
drop table if exists public.trip_members cascade;
drop table if exists public.trips cascade;
drop table if exists public.profiles cascade;
drop function if exists public.is_trip_member(uuid, text);
drop function if exists public.tg_set_updated_at();
drop function if exists public.tg_seed_owner_member();
```

## Incident Log

*(post-mortems for SEV1/SEV2 incidents, authored by [solution-architect])*

## Sprint 2 — R2 Architecture Additions

### B-012 — Trip member invite & accept

**Migration `0003_invitations.sql`** (additive — `trip_invitations` already exists from 0001):
- ADD `revoked_at timestamptz` column.
- ADD partial index `trip_invitations_expires_idx` on `(expires_at) WHERE accepted_at IS NULL AND revoked_at IS NULL`.
- ADD partial unique index `trip_invitations_active_uniq` on `(trip_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL`.
- ADD `get_invitation_by_token(p_token text)` SECURITY DEFINER function — uniform `{status, trip_name?, inviter_name?, email?, role?, expires_at?}` for `pending|expired|used|revoked|invalid`. Anti-enumeration.
- ADD `accept_invitation(p_token text)` SECURITY DEFINER function — atomic FOR UPDATE lock + idempotent `trip_members` upsert + mark used. Raises `token_invalid|token_expired|token_used|token_revoked|unauthenticated`.
- Token expiry: 48h. Token gen: `crypto.randomBytes(32).toString('base64url')` server-side.
- Rollback: drop both functions, drop both new indexes, drop revoked_at.

**API contracts:**

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|------------|-------|
| POST | `/api/trips/[tripId]/invitations` | owner | 10/owner/hr | body `{email, role}`; 201 returns `{invitation: {…, invite_url}}`; 409 `invitation_pending_exists` |
| GET | `/api/trips/[tripId]/invitations` | owner | — | paginated `page`/`limit` (default 20, max 100); token NOT included |
| GET | `/api/invitations/[token]` | public | 30/IP/hr | always 200 with `{status, …}`; never leaks |
| POST | `/api/invitations/[token]/accept` | session | 30/user/hr | calls `accept_invitation` RPC; failure: invalid→404, expired→410, used→409, revoked→410, unauth→401 |

**Audit log verbs:** `invitation_created`, `invitation_accepted`, `invitation_revoked`. Email hashed (sha256, first 16 hex chars).

**Frontend:**
- `app/src/app/trips/[id]/members/page.tsx` — Members tab.
- `app/src/app/invite/[token]/page.tsx` — server component fetches lookup; renders `InviteAcceptCard` (signed-in) / `SignInPrompt` (signed-out, `next=/invite/[token]`) / `InviteErrorState`.
- Components: `InvitationForm`, `PendingInvitationsList`, `InviteAcceptCard`, `InviteErrorState`.

---

### B-009 — Google Places search proxy

**Migration `0004_places.sql`** (new table):
```sql
create table public.places (
  id uuid PK default gen_random_uuid(),
  google_place_id text UNIQUE NOT NULL,
  name text NOT NULL,
  formatted_address text,
  lat numeric(9,6), lng numeric(9,6),
  category text NOT NULL CHECK (category IN (...)),
  cached_details jsonb DEFAULT '{}',
  cached_at timestamptz,
  created_at, updated_at
);
```
RLS: SELECT for authenticated; service-role only writes. Trigger `tg_set_updated_at`. Index `places_category_idx`.

**Internal `PlaceCategory` enum** (canonical, reused by B-009/B-010/B-011):
`restaurant | cafe | bar | sight | museum | shopping | hotel | transport_hub | park | other`

**Mapping** in `app/src/lib/google/categories.ts` as pure fn `mapGoogleTypesToCategory(types) → PlaceCategory`. First-match priority order: restaurant → cafe → bar → museum → sight → shopping → hotel → transport_hub → park → other.

**B-011 prerequisite:** widen `bookmarks.category` CHECK to match — flagged for B-011 R2.

**API — `GET /api/places/search?q=`:**
- Auth: `requireAuth()` (401 anon).
- Validation Zod: q ∈ [2,100] chars; control chars stripped.
- Cache semantics: search results NEVER served from local cache (Google ToS). Side-effect upsert into `places` (slim fields only — `cached_details` reserved for B-010).
- 200: `{ results: [{google_place_id, name, formatted_address, lat, lng, category}] }` — max 20.
- Errors: 400 `invalid_query`, 401 `unauthorized`, 429 `rate_limit_exceeded` + `Retry-After` header, 502 `places_unavailable`, 500 `server_error`.
- Rate limit: 30/user/min, key `places:search:user:${uid}`.
- Audit: `places_searched` (logs `query_length` + `result_count` only).

**Google client wrapper** — `app/src/lib/google/places.ts`: `import 'server-only'`, exports `searchPlaces` + `getPlaceDetails` interface stub (B-010 implements). Endpoint Google Places v1 textSearch with FieldMask. Timeout 5s, retry once on 5xx.

**Performance:** P95 < 800ms cache-miss path.

---

### B-019 — Invitation-only sign-up (remove public sign-up)

**Goal:** Account creation requires a valid, unconsumed invitation token whose `email` matches the submitted email. Public `/sign-up` is removed; the only entry point is `/invite/[token]`.

**Decision 1 — RPC choice (atomicity):** Add a NEW RPC `signup_consume_invitation(p_token text, p_email text, p_user_id uuid)` in additive migration **`0006_signup_invitation.sql`**. The existing `accept_invitation()` RPC depends on `auth.uid()`, but at sign-up time the freshly created auth user has not yet authenticated (no JWT in the request), so a session-driven RPC cannot be used atomically. The new RPC is `SECURITY DEFINER`, takes the new user's id explicitly, and performs token validation + email match + member insert + invitation consumption inside a single transaction with `FOR UPDATE` lock. Justification: choice (a) — materially better atomicity than option (b)'s "validate at route, then call accept_invitation post sign-in" because option (b) requires an extra round-trip and a second auth step before consuming the invitation, opening a window where the user exists but the invitation is uncommitted.

```
signup_consume_invitation(p_token, p_email, p_user_id)
  → returns table(trip_id uuid, role text)
  → raises: 'token_invalid' | 'token_expired' | 'token_used' | 'token_revoked'
            | 'email_mismatch'   (lower(invitation.email) != lower(p_email))
            | 'arg_invalid'      (null/empty inputs)
```

`accept_invitation` is retained unchanged for the existing B-012 `/api/invitations/[token]/accept` flow (used when an already-signed-in user redeems an invitation for an additional trip).

**Decision 2 — Rollback ordering for `POST /api/auth/signup`:**

```
1. Rate-limit check (10/IP/15min — tightened from 5).
2. Zod validate body { invite_token, email, password, confirm_password }.
3. Pre-flight token lookup via get_invitation_by_token(p_token) → must be 'pending';
   verify lower(invitation.email) === lower(submitted email).
   ↳ on failure: 403 with appropriate error code; NO user created.
4. Admin createUser via service-role client (email_confirm: true to allow trip access immediately;
   per AC #5 the server controls confirmation since gating is now the invitation itself).
   ↳ on duplicate email: 200 {ok:true} (anti-enumeration uniform shape).
   ↳ on other error: 500 {server_error}.
5. Call signup_consume_invitation(token, email, new_user_id) via service-role client.
   ↳ on success: audit signup_completed; return 200 {ok:true}.
   ↳ on failure: COMPENSATION — delete the just-created auth user via
       supabase.auth.admin.deleteUser(new_user_id); audit signup_rejected with rpc_error code;
       return 403 with mapped code.
```

**Mid-flight failure handling:** If `signup_consume_invitation` raises `token_used` because a concurrent acceptance won the `FOR UPDATE` race, the compensation deletes the orphan auth user. If `auth.admin.deleteUser` itself fails (extremely rare), log a SEV3 audit entry `signup_compensation_failed` with `{user_id}` for manual cleanup; still return 403 to the client. This is acceptable because (a) the orphan user has no `profiles` row (created on first sign-in, not on auth.users insert), (b) no `trip_members` row was created (RPC failed before insert), (c) the orphan email is permanently locked from re-registration only until manual cleanup — a personal-project tolerable risk.

**Decision 3 — Email match enforcement:** Performed BOTH at the route layer (defense-in-depth, before admin createUser to avoid creating a doomed user) AND inside `signup_consume_invitation` (atomic guard against TOCTOU). This is choice (a) plus belt-and-braces.

**Schema validation — `app/src/lib/validations/auth.ts`:**

```ts
export const SignupInput = z
  .object({
    email: z.string().email().max(254),
    password: PasswordComplexity,
    confirm_password: z.string(),
    invite_token: z
      .string()
      .min(16)                          // 32-byte base64url ≥ 43 chars; 16 is a defensive floor
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/, 'Invalid token format'),
  })
  .refine((d) => d.password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });
```

**API contract — `POST /api/auth/signup`:**

Request:
```json
{ "email": "...", "password": "...", "confirm_password": "...", "invite_token": "..." }
```

Responses (uniform envelope `{ error: { code, message, details } }`):

| Status | Code | When |
|--------|------|------|
| 200 | — `{ok:true}` | Success OR duplicate email (anti-enumeration). |
| 400 | `validation_error` | Zod failure (missing/malformed fields). |
| 403 | `invite_required` | `invite_token` absent or fails regex (caught at validation; mapped before generic validation_error if token field is the only failure). |
| 403 | `invite_invalid` | Token not found. |
| 403 | `invite_expired` | `expires_at` past. |
| 403 | `invite_used` | `accepted_at` already set. |
| 403 | `invite_revoked` | `revoked_at` set. |
| 403 | `invite_email_mismatch` | Submitted email ≠ invitation email (case-insensitive). |
| 429 | `rate_limit_exceeded` | 10/IP/15min exceeded. |
| 500 | `server_error` | Unexpected. |

(Note: `email_already_registered` is intentionally NOT a distinct response — duplicate-email returns 200 to preserve anti-enumeration, matching the Sprint 1 contract.)

**ApiErrorCode additions** (`app/src/lib/api/response.ts`): add `'invite_required' | 'invite_invalid' | 'invite_expired' | 'invite_used' | 'invite_revoked' | 'invite_email_mismatch'`.

**Audit actions:** Extend `AuditAction` union in `app/src/lib/audit.ts` with:
- `signup_completed` — successful invite-gated sign-up (`metadata: { trip_id, role }`).
- `signup_rejected` — any 4xx outcome (`metadata: { reason: 'invite_required'|'invite_invalid'|... }`, no email/token).
- `signup_compensation_failed` — orphan auth user deletion failed (SEV3, manual cleanup).

The existing `signup` action is retained but only emitted on the legacy code path (none after this ships); new path emits `signup_completed`/`signup_rejected`.

**Files plan (R3):**

Backend (`[backend-engineer]`):
- `app/supabase/migrations/0006_signup_invitation.sql` (NEW) + `0006_signup_invitation_rollback.sql`.
- `app/src/lib/validations/auth.ts` — extend `SignupInput`. **SHARED FILE** — flag for code-reviewer; no overlap with frontend in same sprint.
- `app/src/lib/api/response.ts` — extend `ApiErrorCode`. **SHARED FILE** — flag.
- `app/src/lib/audit.ts` — extend `AuditAction`. **SHARED FILE** — flag.
- `app/src/app/api/auth/signup/route.ts` — full rewrite per rollback flow above; switch to service-role admin createUser; remove `supabase.auth.signUp` (which assumes public sign-up).
- `app/src/lib/supabase/service.ts` — confirm `auth.admin` access available; no edits expected.

Frontend (`[frontend-engineer]`):
- `app/src/app/sign-up/page.tsx` — DELETE (or replace with redirect to `/sign-in?notice=invite_only`).
- `app/src/app/sign-in/page.tsx` — show notice banner when `?notice=invite_only`.
- `app/src/app/invite/[token]/page.tsx` — extend to render a `SignupForInviteForm` when `status=pending` AND viewer is signed-out (currently shows `SignInPrompt`); reuse existing `InviteErrorState`.
- `app/src/components/auth/SignupForInviteForm.tsx` (NEW) — read-only email field (pre-filled from server lookup), password fields, hidden token, posts to `/api/auth/signup`.
- Remove any nav links to `/sign-up`.

Shared-file overlaps: `auth.ts`, `response.ts`, `audit.ts` — all backend-owned. No parallel frontend touch this sprint. `[scrum-master]` to sequence: backend lands shared-file edits first, frontend then consumes new types.

**Performance AC:** `POST /api/auth/signup` happy path < 800ms P95 (admin createUser dominant). Rate-limit window 10/IP/15min. Pre-flight token lookup is a single indexed query (token PK).

**Bootstrap admin policy:**

TravelPlanner is an invitation-only personal platform. Public sign-up is permanently disabled because the product is intended for the platform owner and explicitly invited trip partners only. The first user account ("bootstrap admin") was created during Sprint 1 while public sign-up was open; AC #9 of B-019 preserves all such pre-existing accounts unchanged. No application route can create an account without consuming a valid invitation, and only an existing trip owner can mint invitations (B-012). This produces a closed graph rooted at the bootstrap admin.

To add a NEW account outside the invitation flow (e.g., a second admin in the rare case the bootstrap account is lost or for ops migration), the only supported mechanism is **DB-level**: connect to Supabase via the service role and either (a) call `auth.admin.createUser({ email, password, email_confirm: true })` from a one-off script, or (b) insert directly into `auth.users` via a Supabase support migration. Such accounts will have no trip memberships until an invitation is accepted or a `trip_members` row is inserted manually. This bypass is intentionally undocumented in any user-facing surface and gated by service-role credentials held only by the platform owner. No environment variable, feature flag, or admin UI exposes this path.

**Migration rollback (`0006_signup_invitation_rollback.sql`):**
```sql
begin;
drop function if exists public.signup_consume_invitation(text, text, uuid);
commit;
```
The route layer rollback is a code revert: restore the Sprint 1 `signup/route.ts` and remove the new error codes. Pre-existing accounts are unaffected.

**Open questions resolved:**
1. Rollback ordering — confirmed: validate token (pre-flight) → admin-create user → consume RPC → on RPC failure delete auth user. Compensation failure logged SEV3.
2. RPC signature — NEW RPC `signup_consume_invitation(token, email, user_id)` with email match enforced atomically; `accept_invitation` retained for B-012 in-app flow.
3. Bootstrap admin policy — documented above.

---

### B-010 — Place detail cache & page

**No migration.** Reuses `places` table from `0004_places.sql` (B-009). The `cached_details jsonb` and `cached_at timestamptz` columns are already provisioned and reserved for B-010. RLS is unchanged: authenticated SELECT on `places`; writes via service-role only.

**Endpoints:**

| Method | Path | Auth | Rate limit | Notes |
|--------|------|------|------------|-------|
| GET | `/api/places/[googlePlaceId]` | session | 30/user/min | Cache-first; on miss → Google v1 `places.get` + UPSERT `cached_details` + `cached_at`. |
| GET | `/api/places/[googlePlaceId]/photo/[photoRef]?maxWidth=N` | session | 60/user/min | Streaming binary proxy to Google Places photo media; `Cache-Control: public, max-age=604800, immutable`. |

Cache TTL = 7 days (mirrors B-009 search cache window). Reused constant `CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000`.

**Detail response JSON (success 200):**
```ts
// app/src/lib/types/domain.ts — NEW exports
export interface PhotoRef {
  photo_reference: string;     // Google v1 photo "name" tail (after places/{id}/photos/)
  width: number;
  height: number;
  attributions: string[];      // HTML strings — render via dangerouslySetInnerHTML in attribution block ONLY
}

export interface DayHours {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday (Google convention)
  open: string | null;             // "HH:MM" 24h, null if closed all day
  close: string | null;            // "HH:MM" 24h, null if open 24h
}

export interface WeeklyHours {
  periods: DayHours[];             // up to 7 entries; missing day = closed
  weekday_text: string[];          // Google-localized human strings (en); display-only
  open_now?: boolean;              // not stored — computed at read time if available
}

export interface PlaceDetail {
  google_place_id: string;
  name: string;
  formatted_address: string | null;
  lat: number | null;
  lng: number | null;
  category: PlaceCategory;
  rating: number | null;           // 0..5, one decimal
  user_ratings_total: number | null;
  phone: string | null;            // internationalPhoneNumber preferred
  website: string | null;          // canonical website URI
  opening_hours: WeeklyHours | null;
  photos: PhotoRef[];              // capped at 10
  google_maps_url: string | null;  // googleMapsUri
  source: 'cache' | 'google';
  cached_at: string | null;        // ISO 8601
}
```

`PlaceDetail` is added to `app/src/lib/types/domain.ts` alongside `Place`. Re-exported from `lib/google/places.ts`.

**Google FieldMask** (v1 `GET https://places.googleapis.com/v1/places/{id}`):
```
id,displayName,formattedAddress,location,types,rating,userRatingCount,
internationalPhoneNumber,websiteUri,googleMapsUri,regularOpeningHours,
photos.name,photos.widthPx,photos.heightPx,photos.authorAttributions
```
Quota cost note: this mask spans Basic + Contact + Atmosphere SKUs (rating + phone + opening hours). Per-call cost is materially higher than search; the 7-day cache + per-user 30/min rate limit + cache-first read are designed to keep amortized cost low. Photo media calls are billed separately under the Photo SKU; the photo proxy keeps `maxWidth` strictly bounded to four allowed values to prevent quota waste.

**`cached_details` JSONB shape (zod schema, validated on read AND before UPSERT):**

```ts
// app/src/lib/validations/places.ts — additions
export const PhotoRefSchema = z.object({
  photo_reference: z.string().min(1).max(512),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  attributions: z.array(z.string().max(2048)).max(8),
});

export const DayHoursSchema = z.object({
  day: z.number().int().min(0).max(6),
  open: z.string().regex(/^[0-2]\d:[0-5]\d$/).nullable(),
  close: z.string().regex(/^[0-2]\d:[0-5]\d$/).nullable(),
});

export const WeeklyHoursSchema = z.object({
  periods: z.array(DayHoursSchema).max(7),
  weekday_text: z.array(z.string().max(200)).max(7),
});

// Loose at the top level (so upstream Google additions don't break reads)
// but strict on every displayed field.
export const PlaceDetailCachedSchema = z.object({
  rating: z.number().min(0).max(5).nullable(),
  user_ratings_total: z.number().int().min(0).nullable(),
  phone: z.string().max(64).nullable(),
  website: z.string().url().max(2048).nullable(),
  opening_hours: WeeklyHoursSchema.nullable(),
  photos: z.array(PhotoRefSchema).max(10),
  google_maps_url: z.string().url().max(2048).nullable(),
}).passthrough();   // tolerate extra Google fields
```

Slim columns (`name`, `formatted_address`, `lat`, `lng`, `category`) remain authoritative on the row; only the enriched fields live in `cached_details`. Detail UPSERT updates both: slim columns refreshed (in case Google moved the place) AND `cached_details` replaced AND `cached_at = now()`.

**Path validation:**
```ts
export const GooglePlaceIdParam = z.string().min(8).max(255).regex(/^[A-Za-z0-9_-]+$/);
export const PhotoRefParam = z.string().min(8).max(512).regex(/^[A-Za-z0-9_\-/.]+$/);
export const PhotoMaxWidth = z.union([z.literal(200), z.literal(400), z.literal(800), z.literal(1200)]);
```
Anything else → 400 `invalid_place_id` (or `validation_error` for the photo route).

**Photo proxy contract — `GET /api/places/[googlePlaceId]/photo/[photoRef]?maxWidth=N`:**
- Auth: `requireAuth()` (401 anon).
- Validate `googlePlaceId`, `photoRef`, `maxWidth` (must be one of 200|400|800|1200; else 400).
- Verify the photoRef belongs to the place: SELECT `cached_details->'photos'` and check that `photo_reference` matches one entry. If `cached_details` empty, fetch detail first (single Google call) then verify. Mismatch → 404 `not_found`. This prevents using the proxy as an open Google photo proxy with arbitrary refs.
- Call Google v1: `GET https://places.googleapis.com/v1/{photoRef}/media?maxWidthPx={N}&key={KEY}` with `skipHttpRedirect=false` (default; Google returns the binary directly when key is in query, OR a 302 to the CDN URL). Use `fetch` with `redirect: 'follow'`. Server-side only — API key never reaches client.
- Stream the response body back: `new NextResponse(googleRes.body, { status: 200, headers: { 'Content-Type': googleRes.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff' } })`.
- Errors: 502 `places_unavailable` if Google non-2xx; 429 with `Retry-After`; 5s timeout.
- Audit: `place_photo_proxied` with `{ google_place_id, max_width }` (no photoRef in metadata — too long, not useful).

**Detail endpoint flow — `GET /api/places/[googlePlaceId]`:**
1. `requireAuth()` (401 anon).
2. Validate `googlePlaceId` via `GooglePlaceIdParam` → 400 `invalid_place_id` on fail.
3. Rate-limit `places:detail:user:${uid}` 30/60s → 429 + `Retry-After`.
4. Cache lookup: `SELECT * FROM places WHERE google_place_id = $1 AND cached_at >= now() - interval '7 days' AND cached_details <> '{}'` (single row by unique key). If hit → assemble `PlaceDetail` with `source: 'cache'`, audit `place_details_fetched` with `{ source: 'cache' }`, return 200.
5. Cache miss (no row, expired, or empty `cached_details`):
   - Call `getPlaceDetails(googlePlaceId)` (server-only client; 5s timeout; retry once on 5xx).
   - Validate parsed shape (slim fields + `PlaceDetailCachedSchema`).
   - UPSERT row via service-role: refresh slim columns + `cached_details` + `cached_at = now()`.
   - Return 200 with `source: 'google'`. Audit `place_details_fetched` with `{ source: 'google' }`.
6. Google failure → 502 `places_unavailable`. Google 404 (place_id no longer exists) → 404 `place_not_found`.

**Concurrency / dedupe:** If two users request the same `googlePlaceId` on a cache miss in the same instant, both Google calls fire. The final UPSERT is idempotent on `(google_place_id)` so the row converges; `cached_at` reflects whichever wrote last. Tolerable: cost = at most 1 duplicate Google call per uncached place per user-burst window, which is negligible at this scale. NOT mitigating with an in-memory promise map (the app is multi-instance on Vercel). Documented as accepted trade-off.

**ApiErrorCode additions** (`app/src/lib/api/response.ts`): add `'place_not_found'`, `'invalid_place_id'`. (`places_unavailable` already exists from B-009.)

**AuditAction additions** (`app/src/lib/audit.ts`): add `'place_details_fetched'`, `'place_photo_proxied'`. Metadata: `google_place_id`, `source` (`'cache' | 'google'`) for details; `google_place_id`, `max_width` for photo proxy. No PII.

**Component structure (frontend, Next 16 conventions per `app/AGENTS.md`):**
- `app/src/app/places/[id]/page.tsx` — **Server Component**. Receives `params: Promise<{ id: string }>` per Next 16 async params. Calls internal fetch to `/api/places/[id]` with forwarded auth cookie via `cookies()`. Renders `<PlaceDetailView>`.
- `app/src/app/places/[id]/loading.tsx` — skeleton: title + address bar + 3-photo gallery skeleton + hours grid placeholder (mobile-first; uses Tailwind `animate-pulse`).
- `app/src/app/places/[id]/error.tsx` — client error boundary: `place_not_found` → "Place not found" + back link; `places_unavailable` → "Couldn't reach Google Places — try again."
- `app/src/components/places/PlaceDetailView.tsx` — server component composing the sections: name + category badge, address + map link, contact (phone, website), `<OpeningHours>`, `<PhotoGallery>`, rating block, `<GoogleAttribution>`.
- `app/src/components/places/PhotoGallery.tsx` — client component. Renders `<img>` tags using the photo proxy URL (`/api/places/{id}/photo/{ref}?maxWidth=800`), responsive grid, lazy loading, alt text from name. NO direct Google CDN hits.
- `app/src/components/places/OpeningHours.tsx` — pure presentational; consumes `WeeklyHours.weekday_text` for human display + computes `open_now` from `periods` against `Intl.DateTimeFormat` in the trip's timezone (best-effort — opening hours displayed are the place's local hours).
- `app/src/components/places/GoogleAttribution.tsx` — required Google attribution block: "Powered by Google" + per-photo author attributions (HTML from Google, sanitized via DOMPurify if added; otherwise rendered as escaped text initially — flagged for security review).

**Q-Checklist (R2 query performance):**
| # | Check | Verdict |
|---|-------|---------|
| Q-1 | All list queries bounded | N/A — detail is a single-row read by unique key. |
| Q-2 | No N+1 sequential queries | PASS — single `SELECT … WHERE google_place_id = $1`; photo proxy reads same row once. |
| Q-3 | Pagination on list endpoints | N/A — no list. |
| Q-4 | Date-bounded analytics queries | N/A. |

**Files plan (R3) — confirms R1 list:**

Backend (`[backend-engineer]`):
- `app/src/app/api/places/[googlePlaceId]/route.ts` (NEW).
- `app/src/app/api/places/[googlePlaceId]/photo/[photoRef]/route.ts` (NEW).
- `app/src/lib/google/places.ts` — implement `getPlaceDetails` (replace stub) + add `getPlacePhotoStream`. **SHARED FILE** — flag for code-reviewer.
- `app/src/lib/validations/places.ts` — add `GooglePlaceIdParam`, `PhotoRefParam`, `PhotoMaxWidth`, `PhotoRefSchema`, `WeeklyHoursSchema`, `PlaceDetailCachedSchema`. **SHARED FILE** — flag.
- `app/src/lib/types/domain.ts` — add `PhotoRef`, `DayHours`, `WeeklyHours`, `PlaceDetail`. **SHARED FILE** — flag.
- `app/src/lib/api/response.ts` — extend `ApiErrorCode` with `place_not_found`, `invalid_place_id`. **SHARED FILE** — flag.
- `app/src/lib/audit.ts` — extend `AuditAction` with `place_details_fetched`, `place_photo_proxied`. **SHARED FILE** — flag.

Frontend (`[frontend-engineer]`):
- `app/src/app/places/[id]/page.tsx` (NEW) + `loading.tsx` + `error.tsx`.
- `app/src/components/places/PlaceDetailView.tsx` (NEW).
- `app/src/components/places/PhotoGallery.tsx` (NEW).
- `app/src/components/places/OpeningHours.tsx` (NEW).
- `app/src/components/places/GoogleAttribution.tsx` (NEW).
- (Optional) `app/src/lib/hooks/usePlaceDetail.ts` if the page later needs client-side refetch — not required for v1.

**Shared-file overlaps:** `domain.ts`, `validations/places.ts`, `response.ts`, `audit.ts`, `lib/google/places.ts` — all backend-owned. `[scrum-master]` to sequence: backend lands shared edits first; frontend then imports `PlaceDetail` type. Parallel R3 acceptable once types are committed.

**Performance AC:** Cache hit < 50ms server time (single PK lookup). Cache miss < 800ms P95 (Google detail call dominates). Photo proxy < 600ms P95 first byte (streaming).

**Migration numbering for Sprint 2

- `0003_invitations.sql` — B-012
- `0004_places.sql` — B-009
- `0006_signup_invitation.sql` — B-019
- `0007_bookmarks.sql` — B-011 (locked at R2; supersedes earlier `0005_` placeholder)
- (B-010 — no new migration; reuses `0004_places.sql`.)

Each ships with its `*_rollback.sql` sibling. Final SOLUTION_DESIGN consolidation at sprint close will reconcile §2 schema baseline (notably places `formatted_address` rename and removal of unused `ttl_expires_at` column).

---

## B-011 — Bookmarks (Sprint 2, R2 — canonical)

This subsection supersedes §2.10 where it conflicts. It locks the migration spec, category narrowing rules, API contracts, error codes, audit actions, and types for B-011.

### B-011.1 Migration `0007_bookmarks.sql`

```sql
begin;

create table public.bookmarks (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id)        on delete cascade,
  place_id    uuid not null references public.places(id)       on delete cascade,
  category    text not null
                check (category in ('restaurant','sight','museum','shopping','other')),
  notes       text check (notes is null or char_length(notes) <= 500),
  added_by    uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (trip_id, place_id, category)
);

create index bookmarks_trip_idx  on public.bookmarks (trip_id);
create index bookmarks_place_idx on public.bookmarks (place_id);

create trigger bookmarks_set_updated_at
  before update on public.bookmarks
  for each row execute function public.tg_set_updated_at();

alter table public.bookmarks enable row level security;

create policy bookmarks_select on public.bookmarks
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy bookmarks_insert on public.bookmarks
  for insert with check (
    public.is_trip_member(trip_id, 'editor') and added_by = auth.uid()
  );
create policy bookmarks_update on public.bookmarks
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy bookmarks_delete on public.bookmarks
  for delete using (public.is_trip_member(trip_id, 'editor'));

commit;
-- Rollback (0007_bookmarks_rollback.sql):
--   begin;
--   drop trigger if exists bookmarks_set_updated_at on public.bookmarks;
--   drop table if exists public.bookmarks cascade;
--   commit;
```

Notes vs §2.10 (canonical changes):
- ADD `updated_at timestamptz not null default now()` + `bookmarks_set_updated_at` trigger reusing `tg_set_updated_at()`.
- ADD `CHECK char_length(notes) <= 500` (nullable allowed).
- DROP `bookmarks_category_idx (trip_id, category)` — composite with `category` filter is low-selectivity at v1 scale and the unique index covers the `(trip_id, place_id, category)` access pattern. Re-add later if profiling demands it.
- Keep ON DELETE CASCADE on both `trip_id` and `place_id`. `added_by` keeps SET NULL (account deletion preserves the bookmark for other trip members).
- Reuses existing helpers: `public.is_trip_member`, `public.tg_set_updated_at` (defined in `0001_init.sql`).

### B-011.2 Bookmark category enum + narrowing

`BookmarkCategory` is a strict subset of `PlaceCategory`:

```ts
export type BookmarkCategory = 'restaurant' | 'sight' | 'museum' | 'shopping' | 'other';
```

`narrowCategoryForBookmark(c: PlaceCategory): BookmarkCategory` — pure, server-and-client safe; lives in `app/src/lib/bookmarks/categories.ts`.

| PlaceCategory   | → BookmarkCategory | Rationale |
|-----------------|--------------------|-----------|
| `restaurant`    | `restaurant`        | identity |
| `cafe`          | `restaurant`        | culinary stop, no separate bookmark slice |
| `bar`           | `restaurant`        | culinary stop |
| `sight`         | `sight`             | identity |
| `park`          | `sight`             | sight-like; no dedicated nature category |
| `museum`        | `museum`            | identity |
| `shopping`      | `shopping`          | identity |
| `hotel`         | `other`             | logged via accommodations, not bookmarks |
| `transport_hub` | `other`             | logged via transport items, not bookmarks |
| `other`         | `other`             | identity |

The function is pure (`switch` over the discriminator) and exhaustive — TS will fail compile if `PlaceCategory` widens without updating it. The default selected category at POST time is the narrowed value of `places.category`; the user may override before submit (must remain in the BookmarkCategory subset).

### B-011.3 API contracts

Base path: `/api/trips/[tripId]/bookmarks`. All endpoints require auth + trip membership; writes require `editor`+ via `checkTripAccess`. Error envelope is the standard `{ error: { code, message, details } }`.

**POST `/api/trips/[tripId]/bookmarks`** — editor+
- Request: `{ google_place_id: string, category?: BookmarkCategory, notes?: string }` (notes ≤ 500 chars). `category` defaults to `narrowCategoryForBookmark(place.category)`.
- Server resolves `place_id` from `google_place_id` against `places` (must already be cached by B-009/B-010). If not found → `404 place_not_cached`. (Backend MAY optionally fall back to `getPlaceDetails(google_place_id)` to populate the cache; out of scope for R3 unless trivial.)
- 201: `{ bookmark: Bookmark }`.
- Errors: 400 `validation_error`, 401 `unauthorized`, 403 `forbidden`, 404 `not_found` (trip), 404 `place_not_cached`, 409 `bookmark_exists`, 429 `rate_limit_exceeded`.
- Rate limit: 10 POST/min per `(user_id, trip_id)` via existing `lib/rate-limit.ts`.
- Audit: `bookmark_created` with `entity='bookmarks'`, `entity_id=bookmark.id`, `trip_id`.

**GET `/api/trips/[tripId]/bookmarks?category=&page=&limit=`** — viewer+
- Query: `category?: BookmarkCategory` (single filter); `page` default 1; `limit` default 50, max 200.
- 200: `{ bookmarks: Bookmark[], page: number, limit: number, total: number }`.
- Single Supabase select with foreign-table join: `select *, place:places(name, formatted_address, category, lat, lng)` — no N+1.
- Order: `place(name) asc` (stable secondary `id asc`); group-by-category is computed client-side in the Places tab.
- Errors: 400 `invalid_query`, 401, 403, 404 (trip).

**PATCH `/api/trips/[tripId]/bookmarks/[id]`** — editor+
- Request: `{ category?: BookmarkCategory, notes?: string | null }` (at least one field; notes ≤ 500).
- 200: `{ bookmark: Bookmark }`.
- Errors: 400 `validation_error`, 401, 403, 404 (trip or bookmark not in trip), 409 `bookmark_exists` (uniqueness collision after category change).
- Audit: `bookmark_updated`.

**DELETE `/api/trips/[tripId]/bookmarks/[id]`** — editor+
- 204 no body.
- Errors: 401, 403, 404.
- Audit: `bookmark_deleted`.

Cross-tenant safety: every handler calls `checkTripAccess(supabase, tripId, userId, required)` (defense-in-depth alongside RLS). Detail handlers also re-check `bookmark.trip_id === tripId` to prevent cross-trip ID swap; mismatch → 404 (no leak).

### B-011.4 Shared file deltas (R3 must land first)

- `app/src/lib/api/response.ts` — extend `ApiErrorCode` with `'bookmark_exists'`, `'place_not_cached'`. Add helper `bookmarkExists()` if convenient (optional).
- `app/src/lib/audit.ts` — extend `AuditAction` with `'bookmark_created' | 'bookmark_updated' | 'bookmark_deleted'`.
- `app/src/lib/types/domain.ts` — add:
  ```ts
  export type BookmarkCategory = 'restaurant' | 'sight' | 'museum' | 'shopping' | 'other';

  export interface Bookmark {
    id: string;
    trip_id: string;
    place_id: string;
    category: BookmarkCategory;
    notes: string | null;
    added_by: string | null;
    created_at: string;
    updated_at: string;
    place?: Pick<Place, 'name' | 'formatted_address' | 'category' | 'lat' | 'lng'>;
  }
  ```
- `app/src/lib/validations/bookmarks.ts` (NEW): `BookmarkCreateSchema`, `BookmarkPatchSchema`, `BookmarkListQuerySchema` (extends `PageSchema` with `limit` max 200 override + optional `category`).
- `app/src/lib/bookmarks/categories.ts` (NEW): `narrowCategoryForBookmark`, `BOOKMARK_CATEGORIES` const.

### B-011.5 R2 Q-Checklist

| # | Check | Verdict |
|---|-------|---------|
| Q-1 | List queries bounded | YES — `limit` default 50, max 200 (enforced in Zod). |
| Q-2 | No N+1 | YES — single `select` with `place:places(...)` foreign-table join; no per-row fetch. |
| Q-3 | Pagination on list endpoints | YES — GET supports `page`/`limit`. |
| Q-4 | Date-bounded analytics | N/A — no analytics queries in B-011. |

### B-011.6 R3 Files plan

Backend (`[backend-engineer]`):
- `app/supabase/migrations/0007_bookmarks.sql` (NEW) + `0007_bookmarks_rollback.sql` (NEW).
- `app/src/app/api/trips/[tripId]/bookmarks/route.ts` (NEW) — GET, POST.
- `app/src/app/api/trips/[tripId]/bookmarks/[id]/route.ts` (NEW) — PATCH, DELETE.
- `app/src/lib/validations/bookmarks.ts` (NEW). **SHARED dir** — flag.
- `app/src/lib/bookmarks/categories.ts` (NEW).
- `app/src/lib/api/response.ts` — extend ApiErrorCode. **SHARED FILE** — flag.
- `app/src/lib/audit.ts` — extend AuditAction. **SHARED FILE** — flag.
- `app/src/lib/types/domain.ts` — add `Bookmark`, `BookmarkCategory`. **SHARED FILE** — flag.

Frontend (`[frontend-engineer]`):
- `app/src/app/trips/[id]/places/page.tsx` (NEW) — Places tab listing bookmarks grouped by category.
- `app/src/components/bookmarks/BookmarkList.tsx`, `BookmarkItem.tsx`, `BookmarkForm.tsx`, `BookmarkDeleteDialog.tsx` (NEW).
- `app/src/components/places/BookmarkButton.tsx` (NEW) — embedded in `PlaceDetailView` from B-010.
- `app/src/lib/hooks/useBookmarks.ts` (NEW).

Shared-file overlap with parallel B-019 (signup) work: `response.ts`, `audit.ts`, `domain.ts`. `[scrum-master]` to sequence: B-011 backend lands its shared edits first; B-019 rebases. No conflicting field renames — additive only.

### B-011.7 Performance AC

- POST: P95 < 300ms (one place lookup + one insert + one audit insert).
- GET: P95 < 250ms for ≤ 200 rows with join (`bookmarks_trip_idx` + PK on places).
- PATCH/DELETE: P95 < 200ms.

### B-011.8 Rollback

- DB: run `0007_bookmarks_rollback.sql` (drops trigger then table).
- API: feature is additive — no breaking changes to existing endpoints.
- Frontend: Places tab is a new route — removing the link from trip nav cleanly hides it.

---

## Sprint 3 — R2 Architecture Additions

> Sprint 3 covers **B-007 Transportation fields**, **B-008 Accommodations**, **B-013 Member role management**.
> The subsections below SUPERSEDE the matching baseline tables in §2.8 (`transportation`) and §2.9 (`accommodations`) where they conflict, and ADD owner-only role-management endpoints + RLS deltas to §2.3 / §4.3.
> Migrations introduced this sprint: `0008_transportation.sql`, `0009_accommodations.sql`, `0010_member_role_mgmt.sql`. (Migration `0005` is intentionally absent in the repo; the next contiguous block is 0008–0010 — confirmed via `ls app/supabase/migrations/`.)

---

### B-007 — Transportation fields (Sprint 3)

#### B-007.1 Schema delta — `transportation` (supersedes §2.8)

The Sprint-0 baseline `transportation` table had `trip_id` + `day_id` columns and no link to `itinerary_items`. R1 confirms transportation is a **child of an `itinerary_items` row of `type='transport'`** in 1:1 ON DELETE CASCADE. Sprint 3 reshapes the table accordingly. Because no Sprint has built routes against the baseline `transportation` table yet (Sprint 1 created only the schema; no API routes exist), the migration safely drops + recreates within a single transaction.

```sql
-- 0008_transportation.sql (spec — written by [backend-engineer] in R3)
create table public.transportation (
  id                  uuid primary key default gen_random_uuid(),
  itinerary_item_id   uuid not null unique
                        references public.itinerary_items(id) on delete cascade,
  trip_id             uuid not null
                        references public.trips(id) on delete cascade,
  mode                text not null
                        check (mode in ('flight','train','bus','car','ferry')),
  carrier             text check (carrier is null or char_length(carrier) <= 120),
  confirmation        text check (confirmation is null or char_length(confirmation) <= 80),
  departure_location  text check (departure_location is null or char_length(departure_location) <= 200),
  arrival_location    text check (arrival_location is null or char_length(arrival_location) <= 200),
  departure_time      timestamptz,
  arrival_time        timestamptz,
  cost                numeric(14,2) check (cost is null or cost >= 0),
  currency            char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes               text check (notes is null or char_length(notes) <= 2000),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint transportation_time_order
    check (departure_time is null or arrival_time is null or arrival_time >= departure_time)
);
```

**Indexes:**
- `unique (itinerary_item_id)` — enforces 1:1.
- `transportation_trip_idx (trip_id)` — covers list endpoint without joining `itinerary_items`.
- `transportation_depart_idx (trip_id, departure_time nulls last)` — supports the trip-overview ordering (`order by departure_time nulls last`) without seq-scan; satisfies AC-6.

**Denormalized `trip_id`** — kept (yes, denormalized from `itinerary_items.trip_id`) for two reasons:
1. The list endpoint and RLS policy both filter by `trip_id`; avoiding the join keeps lookups single-table and preserves a clean `is_trip_member(trip_id, …)` invocation.
2. Cross-tenant safety: a malicious `itinerary_item_id` swap is caught by both RLS (independent `trip_id` membership check) and a pre-insert app-layer guard ensuring `transportation.trip_id === itinerary_items.trip_id`. Backend MUST set `transportation.trip_id` server-side from the URL — never accept it from the body.

**RLS:**
```sql
alter table public.transportation enable row level security;
create policy transportation_select on public.transportation
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy transportation_insert on public.transportation
  for insert with check (public.is_trip_member(trip_id, 'editor'));
create policy transportation_update on public.transportation
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy transportation_delete on public.transportation
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

**Trigger:** `transportation_set_updated_at` reusing `public.tg_set_updated_at()`.

**Rollback (`0008_transportation_rollback.sql`):**
```sql
begin;
drop trigger if exists transportation_set_updated_at on public.transportation;
drop table if exists public.transportation cascade;
commit;
```
The rollback recreates the Sprint-0 baseline shape only if needed for an emergency restore; in practice the Sprint-0 table had no consumers, so a drop-only rollback is acceptable.

#### B-007.2 API contract — extend existing routes (no new path)

R1 AC-7/AC-8 lock the design: a transport itinerary item is created/edited via the existing items endpoint, not a separate `/transportation` POST. The `/api/trips/[id]/transportation` route is **read-only** (list for the overview).

**`POST /api/trips/[tripId]/days/[dayId]/items`** — extended, editor+
- Body when `type === 'transport'`:
  ```ts
  {
    type: 'transport',
    title: string,           // shared with itinerary_items
    start_time?: string,     // ISO-8601; if present mirrors transportation.departure_time
    end_time?: string,       // ISO-8601; if present mirrors transportation.arrival_time
    notes?: string,
    place_id?: string | null,
    transportation: {
      mode: 'flight'|'train'|'bus'|'car'|'ferry',
      carrier?: string,
      confirmation?: string,
      departure_location?: string,
      arrival_location?: string,
      departure_time?: string,    // ISO-8601 — stored as timestamptz UTC
      arrival_time?: string,
      cost?: number,
      currency?: string,           // ISO 4217
    }
  }
  ```
- **AC-10 enforcement:** when `type='transport'`, `itinerary_items.cost` and `itinerary_items.currency` MUST be null; cost lives only on `transportation`. Validated server-side; 400 `validation_error` if client sends both.
- **Atomicity (AC-7):** wrap the two inserts in a single Postgres transaction. Implementation note for [backend-engineer]: the simplest correct approach is a `SECURITY DEFINER` RPC `create_transport_item(p_trip_id, p_day_id, p_title, p_notes, p_place_id, p_transportation jsonb)` that performs both inserts and returns the new IDs. Rationale: the Supabase JS client cannot wrap two `.insert()` calls in a single transaction client-side; an RPC is the only clean atomic path. Defer the RPC unless [backend-engineer] confirms the client-side workaround (insert items, then insert transportation, on failure delete items) cannot meet the AC — which it can't, because a network failure between the two writes leaves a stranded items row.
  - **Decision:** REQUIRE an RPC `create_transport_item`. This belongs in `0008_transportation.sql`. Returns `{ item_id, transportation_id }`.
- 201: `{ item: ItineraryItem, transportation: Transportation }`.

**`PATCH /api/trips/[tripId]/days/[dayId]/items/[itemId]`** — extended, editor+
- Same atomic semantics. Three cases:
  1. `type` unchanged + still `transport` → update both rows in single RPC `update_transport_item`.
  2. `type` changing FROM `transport` to anything else → RPC deletes the linked `transportation` row first, then updates `itinerary_items.type`. The 1:1 unique constraint guarantees there is at most one transportation row.
  3. `type` changing TO `transport` from another type → RPC inserts a new `transportation` row keyed to the existing `itinerary_items.id` (the body MUST include the `transportation` sub-payload; otherwise 400 `validation_error`).
- **Decision:** REQUIRE an RPC `update_transport_item(p_item_id, p_patch jsonb, p_transportation jsonb | null, p_new_type text | null)`. Atomic. Same `0008` migration.
- 200: `{ item: ItineraryItem, transportation: Transportation | null }`.

**`GET /api/trips/[tripId]/transportation?page=&limit=`** — viewer+
- Query: `page` default 1, `limit` default 20 max 100 (shared `PageSchema`).
- Single Supabase select with foreign-table join: `select *, item:itinerary_items!inner(id, day_id, title)` — no N+1.
- Order: `order by departure_time asc nulls last, id asc` (stable). Uses `transportation_depart_idx`.
- 200: `{ items: TransportationWithItem[], page, limit, total }`.
- AC-6 enforcement: `total` from a parallel `count` head request; the join is inner so `transportation` rows whose `itinerary_item` was deleted don't appear (CASCADE deletes the row anyway, but defense-in-depth).
- Errors: 400 `invalid_query`, 401, 403, 404 (trip).

**`GET /api/trips/[tripId]/items/[itemId]`** — extended to embed `transportation` when type='transport':
- Response shape: `{ item: ItineraryItem, transportation?: Transportation }`. Single query with `item:itinerary_items(*, transportation:transportation(*))` foreign-table join.

**`DELETE /api/trips/[tripId]/days/[dayId]/items/[itemId]`** — unchanged route; ON DELETE CASCADE on the FK removes the linked transportation row automatically. No application code change required.

No standalone `POST /api/trips/[tripId]/transportation` create/update/delete endpoints. The Sprint-0 baseline §4.6 entry is **superseded** by this Sprint 3 design — only the GET list survives.

#### B-007.3 Validation schema (Zod)

`app/src/lib/validations/transportation.ts` (NEW):

```ts
import { z } from 'zod';
import { Iso4217Schema } from './common';

export const TransportMode = z.enum(['flight','train','bus','car','ferry','other']);
// Sprint 4 reconciliation (B-016 Trello import): `'other'` added to Zod, the
// `app/src/lib/types/transportation.ts` union, and the DB CHECK (relaxed in
// migration 0011_trello_import.sql) so all three sources of truth agree.

export const TransportationCreate = z.object({
  mode: TransportMode,
  carrier: z.string().min(1).max(120).optional(),
  confirmation: z.string().min(1).max(80).optional(),
  departure_location: z.string().min(1).max(200).optional(),
  arrival_location: z.string().min(1).max(200).optional(),
  departure_time: z.string().datetime({ offset: true }).optional(),
  arrival_time:   z.string().datetime({ offset: true }).optional(),
  cost: z.number().nonnegative().max(1_000_000_000).optional(),
  currency: Iso4217Schema.optional(),
  notes: z.string().max(2000).optional(),
}).refine(
  d => !d.departure_time || !d.arrival_time || d.arrival_time >= d.departure_time,
  { path: ['arrival_time'], message: 'arrival_time must be on or after departure_time' }
).refine(
  // Cost requires currency and vice versa
  d => (d.cost == null) === (d.currency == null),
  { path: ['currency'], message: 'cost and currency must be set together' }
);

export const TransportationPatch = TransportationCreate.partial();

// Composed item-create schema lives in validations/itinerary-items.ts:
// when type === 'transport': itinerary_items.cost / currency MUST be undefined,
// and body.transportation MUST be present.
```

Update `app/src/lib/validations/itinerary-items.ts`:
- `ItineraryItemCreate` becomes a discriminated union on `type`. The `transport` variant requires a `transportation: TransportationCreate` field and forbids `cost`/`currency` on the parent.
- `ItineraryItemPatch` similarly handles the three type-change cases described in B-007.2.

#### B-007.4 Types (`app/src/lib/types/domain.ts`)

```ts
export type TransportMode = 'flight' | 'train' | 'bus' | 'car' | 'ferry' | 'other';
// Sprint 4: `'other'` added — see TransportMode reconciliation note above.

export interface Transportation {
  id: string;
  itinerary_item_id: string;
  trip_id: string;
  mode: TransportMode;
  carrier: string | null;
  confirmation: string | null;
  departure_location: string | null;
  arrival_location: string | null;
  departure_time: string | null;   // ISO-8601 UTC
  arrival_time: string | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransportationWithItem extends Transportation {
  item: Pick<ItineraryItem, 'id' | 'day_id' | 'title'>;
}
```

#### B-007.5 Audit, errors

- `AuditAction` additions: `'transport_item_created' | 'transport_item_updated' | 'transport_item_deleted'`. Metadata: `{ mode, has_confirmation: boolean }` — never the booking reference itself.
- `ApiErrorCode` additions: `'transport_payload_required'` (PATCH to type=transport without `transportation` body), `'transport_cost_on_item_forbidden'`.

#### B-007.6 R2 Q-Checklist

| # | Check | Verdict |
|---|-------|---------|
| Q-1 | List queries bounded | YES — `PageSchema` enforces max 100. |
| Q-2 | No N+1 | YES — list uses single foreign-table join; detail uses single nested select. |
| Q-3 | Pagination | YES — `page`/`limit` on GET list. |
| Q-4 | Date-bounded analytics | N/A — no aggregation endpoint in B-007. |

#### B-007.7 R3 files plan

Backend (`[backend-engineer]`):
- `app/supabase/migrations/0008_transportation.sql` (NEW) + `0008_transportation_rollback.sql`.
  Includes: table + indexes + RLS + trigger + RPCs `create_transport_item`, `update_transport_item`.
- `app/src/app/api/trips/[tripId]/transportation/route.ts` (NEW) — GET list only.
- `app/src/app/api/trips/[tripId]/days/[dayId]/items/route.ts` — extend POST to dispatch to RPC for transport.
- `app/src/app/api/trips/[tripId]/days/[dayId]/items/[itemId]/route.ts` — extend PATCH; GET embeds transportation.
- `app/src/lib/validations/transportation.ts` (NEW).
- `app/src/lib/validations/itinerary-items.ts` — refactor to discriminated union. **SHARED FILE** — flag for reviewer.
- `app/src/lib/types/domain.ts` — add `Transportation`, `TransportMode`, `TransportationWithItem`. **SHARED FILE** — flag.
- `app/src/lib/api/response.ts` — extend `ApiErrorCode`. **SHARED FILE** — flag.
- `app/src/lib/audit.ts` — extend `AuditAction`. **SHARED FILE** — flag.

Frontend (`[frontend-engineer]`):
- `app/src/components/itinerary/TransportationFields.tsx` (NEW) — sub-form rendered conditionally inside `ItineraryItemForm` when `type='transport'`.
- `app/src/components/itinerary/ItineraryItemForm.tsx` — extend with type-conditional rendering + payload composition (`transportation` sub-object when type='transport').
- `app/src/components/itinerary/ItineraryItemRow.tsx` — show mode badge + carrier on transport rows.
- `app/src/app/trips/[id]/transportation/page.tsx` — server component listing all transport segments grouped optionally by day; uses `GET /transportation`.
- `app/src/app/trips/[id]/page.tsx` — overview gains a "Transportation" summary (top 5 by departure_time) — calls list endpoint with `limit=5`.
- `app/src/lib/hooks/useTransportation.ts` (NEW) — wraps GET list + invalidates on item mutation.

#### B-007.8 Performance AC

- POST/PATCH transport item: P95 < 500ms (one RPC, two inserts inside Postgres).
- GET list (≤100 items): P95 < 250ms.
- Trip overview transport block (top 5): P95 < 150ms.

---

### B-008 — Accommodations (Sprint 3)

#### B-008.1 Schema delta — `accommodations` (supersedes §2.9)

R1 AC-1 specifies "hotel name **or** place link"; the baseline §2.9 has `name not null`. Sprint 3 relaxes this and adds the place-or-name conditional + the `created_by` audit column + check-out same-day allowance (`>=`, already in baseline) + per-trip date-range guarantee (app-layer; the cross-table CHECK is rejected by Postgres because subqueries aren't allowed in CHECK constraints — defense-in-depth via trigger).

```sql
-- 0009_accommodations.sql (spec)
create table public.accommodations (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  place_id         uuid references public.places(id) on delete set null,
  hotel_name       text check (hotel_name is null or char_length(hotel_name) between 1 and 200),
  check_in_date    date not null,
  check_out_date   date not null,
  confirmation     text check (confirmation is null or char_length(confirmation) <= 80),
  cost_per_night   numeric(14,2) check (cost_per_night is null or cost_per_night >= 0),
  total_cost       numeric(14,2) check (total_cost is null or total_cost >= 0),
  currency         char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint accommodations_dates_valid
    check (check_out_date >= check_in_date),
  constraint accommodations_name_or_place
    check (place_id is not null or hotel_name is not null)
);
```

**Indexes:**
- `accommodations_trip_idx (trip_id)` — list filter.
- `accommodations_trip_dates_idx (trip_id, check_in_date, check_out_date)` — drives both the list ordering and the day-view indicator query (range overlap).
- `accommodations_place_idx (place_id)` — only when not null; partial.
  ```sql
  create index accommodations_place_idx on public.accommodations(place_id) where place_id is not null;
  ```

**Trigger:** `accommodations_set_updated_at` reusing `public.tg_set_updated_at()`.

**Trip-date-range trigger** (defense-in-depth; AC-2):
```sql
create or replace function public.tg_accommodation_within_trip()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s date; e date;
begin
  select start_date, end_date into s, e from public.trips where id = new.trip_id;
  if s is null then raise exception 'trip_not_found' using errcode = 'P0002'; end if;
  if new.check_in_date  < s or new.check_in_date  > e then
    raise exception 'check_in_out_of_range' using errcode = '23514';
  end if;
  if new.check_out_date < s or new.check_out_date > e then
    raise exception 'check_out_out_of_range' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger accommodations_within_trip
  before insert or update on public.accommodations
  for each row execute function public.tg_accommodation_within_trip();
```

**RLS:**
```sql
alter table public.accommodations enable row level security;
create policy accommodations_select on public.accommodations
  for select using (public.is_trip_member(trip_id, 'viewer'));
create policy accommodations_insert on public.accommodations
  for insert with check (public.is_trip_member(trip_id, 'editor'));
create policy accommodations_update on public.accommodations
  for update using (public.is_trip_member(trip_id, 'editor'));
create policy accommodations_delete on public.accommodations
  for delete using (public.is_trip_member(trip_id, 'editor'));
```

**Rollback (`0009_accommodations_rollback.sql`):**
```sql
begin;
drop trigger if exists accommodations_within_trip on public.accommodations;
drop function if exists public.tg_accommodation_within_trip();
drop trigger if exists accommodations_set_updated_at on public.accommodations;
drop table if exists public.accommodations cascade;
commit;
```

#### B-008.2 API contract — full CRUD

Base path: `/api/trips/[tripId]/accommodations`. Standard error envelope.

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[tripId]/accommodations` | viewer+ | `page`, `limit` | `{ items: AccommodationWithPlace[], page, limit, total }` | 401, 403, 404 |
| POST | `/api/trips/[tripId]/accommodations` | editor+ | `AccommodationCreate` | `201 { accommodation }` | 400, 401, 403, 404 |
| GET | `/api/trips/[tripId]/accommodations/[id]` | viewer+ | — | `{ accommodation: AccommodationWithPlace }` | 401, 403, 404 |
| PATCH | `/api/trips/[tripId]/accommodations/[id]` | editor+ | `AccommodationPatch` | `{ accommodation }` | 400, 401, 403, 404 |
| DELETE | `/api/trips/[tripId]/accommodations/[id]` | editor+ | — | `204` | 401, 403, 404 |

- List uses single Supabase select: `select *, place:places(id, name, formatted_address, lat, lng)`. Order: `check_in_date asc, id asc`. Pagination: `PageSchema` (`limit` default 20, max 100). AC-6 P95 < 500ms — covered by `accommodations_trip_dates_idx`.
- POST resolves `place_id` from optional `google_place_id` against `places` (existing helper from B-009/B-010). If neither `place_id`, `google_place_id`, nor `hotel_name` provided → 400 `validation_error` (mirrors DB CHECK).
- AC-2 trip-range validation: app-layer pre-validation against the trip's `start_date`/`end_date` (single SELECT before insert) PLUS the DB trigger as defense-in-depth. App layer maps trigger's `check_in_out_of_range`/`check_out_out_of_range` exceptions to 400 `validation_error` with field-level detail.
- DELETE returns 204; ON DELETE CASCADE on `trip_id` + the unique-by-id removal automatically clears day-view indicators (they are computed, not stored — see B-008.4).

#### B-008.3 Validation schema (Zod)

`app/src/lib/validations/accommodations.ts` (NEW):

```ts
import { z } from 'zod';
import { IsoDateSchema, Iso4217Schema, UuidSchema } from './common';

export const AccommodationCreate = z.object({
  // EXACTLY ONE of place_id | google_place_id | hotel_name (or place_id with optional name override)
  place_id: UuidSchema.optional(),
  google_place_id: z.string().min(8).max(255).regex(/^[A-Za-z0-9_-]+$/).optional(),
  hotel_name: z.string().min(1).max(200).optional(),
  check_in_date:  IsoDateSchema,
  check_out_date: IsoDateSchema,
  confirmation:   z.string().min(1).max(80).optional(),
  cost_per_night: z.number().nonnegative().max(1_000_000_000).optional(),
  total_cost:     z.number().nonnegative().max(1_000_000_000).optional(),
  currency:       Iso4217Schema.optional(),
  notes:          z.string().max(2000).optional(),
}).refine(
  d => !!(d.place_id || d.google_place_id || d.hotel_name),
  { path: ['hotel_name'], message: 'Provide hotel_name, place_id, or google_place_id' }
).refine(
  d => d.check_out_date >= d.check_in_date,
  { path: ['check_out_date'], message: 'check_out_date must be on or after check_in_date' }
).refine(
  // currency required if either cost provided
  d => !((d.cost_per_night != null || d.total_cost != null) && d.currency == null),
  { path: ['currency'], message: 'currency required when cost provided' }
);

export const AccommodationPatch = AccommodationCreate.partial();

export const AccommodationListQuery = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
```

#### B-008.4 Day-view indicator query — single batched read (no N+1)

The day view (B-005) renders all `trip_days` for a trip in one server-component fetch. AC-4 requires a per-day "Check in: …", "Staying at: …", or "Check out: …" indicator on every day overlapped by an accommodation. The architecture choice is between (a) a Postgres view + a single SELECT joining days with accommodations, or (b) a `SECURITY DEFINER` RPC returning a structured payload. We choose **(a)** because it composes naturally with Supabase row-level security (RLS) — the view inherits RLS from underlying tables — and avoids RPC-shape coupling between backend and frontend.

```sql
-- Part of 0009_accommodations.sql:
create or replace view public.trip_day_accommodation_indicators
with (security_invoker = true) as
select
  d.id                      as day_id,
  d.trip_id                 as trip_id,
  a.id                      as accommodation_id,
  coalesce(a.hotel_name, p.name) as hotel_name,
  case
    when d.date = a.check_in_date  and d.date = a.check_out_date then 'same_day'
    when d.date = a.check_in_date  then 'check_in'
    when d.date = a.check_out_date then 'check_out'
    else 'in_stay'
  end as indicator_type
from public.trip_days d
join public.accommodations a
  on a.trip_id = d.trip_id
  and d.date between a.check_in_date and a.check_out_date
left join public.places p on p.id = a.place_id;
```

Notes:
- `security_invoker = true` (Postgres 15+) means the view is queried with the caller's RLS — `is_trip_member(trip_id, 'viewer')` is enforced via the underlying `trip_days`/`accommodations` policies. No new policy required on the view.
- Indicator semantics: `same_day` covers AC-2's "same-day stays allowed" — a 1-night stay where `check_in_date = check_out_date`. The frontend renders this as a single combined "Check in / Check out: [hotel]" badge.
- The view is computed; no storage cost; no triggers needed for indicator maintenance.
- Index: query plan uses `accommodations_trip_dates_idx (trip_id, check_in_date, check_out_date)` for the range join.

**Frontend usage (in B-005 day-list server component):**

```ts
const { data: indicators } = await supabase
  .from('trip_day_accommodation_indicators')
  .select('day_id, accommodation_id, hotel_name, indicator_type')
  .eq('trip_id', tripId);
// Group client-side: Map<day_id, IndicatorRow[]>
```

This is a single SELECT regardless of trip length or accommodation count — explicit Q-2 N+1 mitigation.

#### B-008.5 Types (`app/src/lib/types/domain.ts`)

```ts
export interface Accommodation {
  id: string;
  trip_id: string;
  place_id: string | null;
  hotel_name: string | null;
  check_in_date: string;       // ISO date
  check_out_date: string;
  confirmation: string | null;
  cost_per_night: number | null;
  total_cost: number | null;
  currency: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccommodationWithPlace extends Accommodation {
  place?: Pick<Place, 'id' | 'name' | 'formatted_address' | 'lat' | 'lng'> | null;
}

export type AccommodationIndicatorType = 'check_in' | 'in_stay' | 'check_out' | 'same_day';

export interface AccommodationDayIndicator {
  day_id: string;
  accommodation_id: string;
  hotel_name: string;
  indicator_type: AccommodationIndicatorType;
}
```

#### B-008.6 Audit, errors

- `AuditAction` additions: `'accommodation_created' | 'accommodation_updated' | 'accommodation_deleted'`. Metadata: `{ has_place_link: boolean, nights: number }`.
- `ApiErrorCode` additions: `'accommodation_dates_out_of_trip'`, `'accommodation_name_or_place_required'`.

#### B-008.7 R2 Q-Checklist

| # | Check | Verdict |
|---|-------|---------|
| Q-1 | List queries bounded | YES — `PageSchema` max 100. |
| Q-2 | No N+1 | YES — list joins via foreign-table; day-view indicators via single view query. |
| Q-3 | Pagination | YES — `page`/`limit` on GET list. |
| Q-4 | Date-bounded analytics | N/A — no aggregation in B-008 (totals are computed in B-014 expenses). |

#### B-008.8 R3 files plan

Backend (`[backend-engineer]`):
- `app/supabase/migrations/0009_accommodations.sql` (NEW) + rollback. Includes table + indexes + trigger + view `trip_day_accommodation_indicators` + RLS.
- `app/src/app/api/trips/[tripId]/accommodations/route.ts` (NEW) — GET, POST.
- `app/src/app/api/trips/[tripId]/accommodations/[id]/route.ts` (NEW) — GET, PATCH, DELETE.
- `app/src/lib/validations/accommodations.ts` (NEW).
- `app/src/lib/types/domain.ts` — add `Accommodation`, `AccommodationWithPlace`, `AccommodationIndicatorType`, `AccommodationDayIndicator`. **SHARED FILE** — flag.
- `app/src/lib/api/response.ts` — extend ApiErrorCode. **SHARED FILE** — flag.
- `app/src/lib/audit.ts` — extend AuditAction. **SHARED FILE** — flag.

Frontend (`[frontend-engineer]`):
- `app/src/app/trips/[id]/accommodations/page.tsx` (NEW) — list grouped/sorted by check-in.
- `app/src/components/accommodations/AccommodationsList.tsx`, `AccommodationItem.tsx`, `AccommodationForm.tsx`, `AccommodationDeleteDialog.tsx` (NEW).
- `app/src/components/accommodations/AccommodationDayBadge.tsx` (NEW) — renders one of "Check in: …", "Check out: …", "Staying at: …", "Check in / Check out: …" badges per `AccommodationIndicatorType`.
- `app/src/app/trips/[id]/itinerary/page.tsx` — extend the day-list server fetch to also query `trip_day_accommodation_indicators` and pass per-day badges into the day component.
- `app/src/components/itinerary/DayCard.tsx` — render `AccommodationDayBadge` rows above the day's items.
- `app/src/app/trips/[id]/page.tsx` — overview gains an "Accommodations" summary (top 5 by check_in_date).
- `app/src/lib/hooks/useAccommodations.ts` (NEW).

#### B-008.9 Performance AC

- POST/PATCH: P95 < 300ms.
- GET list: P95 < 300ms.
- Day-view indicator query: P95 < 100ms for typical trips (≤ 30 days, ≤ 10 stays) — single index range scan.

---

### B-013 — Member role management (Sprint 3)

#### B-013.1 Schema delta — no new tables

R1 confirms B-013 operates entirely on the existing `trip_members` table. The Sprint-0 baseline §2.3 already enables UPDATE / DELETE for owners via `is_trip_member(trip_id, 'owner')`, so the **policies themselves do not need to change** — owners can already update roles and delete other members.

What Sprint 3 ADDS is **defense-in-depth self-removal protection at the database layer** (AC-3) so that a buggy or malicious client cannot bypass the app-layer guard, plus a verification pass on `ON DELETE SET NULL` cascades for authored content (AC-8).

```sql
-- 0010_member_role_mgmt.sql (spec)
begin;

-- AC-3 / defense-in-depth: prevent a member (including an owner) from deleting
-- their own trip_members row via the API. The current policy permits
-- `or user_id = auth.uid()` for the "leave trip" case — we tighten this for owners only.
-- Decision: replace the trip_members_delete policy. Self-removal remains allowed for
-- editor/viewer (they may "leave a trip"); owner self-removal is rejected at the DB layer.

drop policy if exists trip_members_delete on public.trip_members;

create policy trip_members_delete on public.trip_members
  for delete using (
    -- Owner-of-the-trip removing someone else (possibly another owner — multi-owner allowed)
    (public.is_trip_member(trip_id, 'owner') and user_id <> auth.uid())
    or
    -- Editor/viewer leaving the trip themselves
    (user_id = auth.uid()
     and exists (
       select 1 from public.trip_members me
       where me.trip_id = trip_members.trip_id
         and me.user_id = auth.uid()
         and me.status  = 'accepted'
         and me.role in ('editor','viewer')
     ))
  );

-- AC-8 cascade verification: confirm SET NULL on authored-content FKs.
-- The Sprint-0 baseline already declares these:
--   itinerary_items.created_by  → on delete set null  ✔
--   bookmarks.added_by          → on delete set null  ✔ (B-011 0007 confirmed)
--   expenses.paid_by            → on delete set null  ✔
-- No FK changes are required. This block is intentionally a no-op in the migration —
-- present as a documentation comment + a guard query that will RAISE if a future
-- migration regresses the cascade rule.

do $$
declare bad int;
begin
  select count(*) into bad
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = rc.constraint_name
   and kcu.constraint_schema = rc.constraint_schema
  where rc.constraint_schema = 'public'
    and rc.delete_rule <> 'SET NULL'
    and (
      (kcu.table_name = 'itinerary_items' and kcu.column_name = 'created_by') or
      (kcu.table_name = 'bookmarks'        and kcu.column_name = 'added_by')  or
      (kcu.table_name = 'expenses'         and kcu.column_name = 'paid_by')
    );
  if bad > 0 then
    raise exception 'authored_content_cascade_regression';
  end if;
end $$;

commit;
```

**Rollback (`0010_member_role_mgmt_rollback.sql`):**
```sql
begin;
drop policy if exists trip_members_delete on public.trip_members;
-- restore the Sprint-0 baseline policy (allowed self-delete for any role):
create policy trip_members_delete on public.trip_members
  for delete using (
    public.is_trip_member(trip_id, 'owner')
    or user_id = auth.uid()
  );
commit;
```

**Note on multi-owner promotion (AC-2):** No DB constraint change required. Promoting a member to `owner` simply UPDATEs `trip_members.role = 'owner'`; the existing `trip_members_update` policy (`is_trip_member(trip_id,'owner')`) gates this. Multiple owners coexist with equal authority. Demoting another owner is similarly an UPDATE — also gated to owner role. The only protected operation is owner self-removal (AC-3); ownership transfer is an entirely separate future backlog item per R1.

#### B-013.2 API contracts — adds `PATCH` route, refines `DELETE`

The Sprint-2 §4.3 entry shows `DELETE /api/trips/[id]/members?user_id=` with role "owner (or self)". Sprint 3 RESHAPES this:

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[tripId]/members` | viewer+ | `page`, `limit` | `{ items: (TripMember & { profile })[], total }` | 401, 403, 404 |
| **PATCH** | **`/api/trips/[tripId]/members/[userId]`** | **owner** | `{ role: 'owner'\|'editor'\|'viewer' }` | `{ member: TripMember }` | 400, 401, 403, 404, 409 |
| **DELETE** | **`/api/trips/[tripId]/members/[userId]`** | **owner (other) / self (non-owner)** | — | `204` | 401, 403, 404 |

Path-style `[userId]` replaces the query-string variant for REST consistency with the rest of the API. The query-string form was never built in Sprint 2 (no implementation existed), so this is not a breaking change.

**`PATCH /api/trips/[tripId]/members/[userId]`** — owner-only
- Body: `{ role: 'owner' | 'editor' | 'viewer' }`. Validated by `MemberRoleUpdate` Zod schema.
- Pre-conditions:
  1. `requireAuth()` (401 if anon).
  2. `checkTripAccess(tripId, 'owner')` (403 `forbidden` if requester is not an owner).
  3. Target member exists in this trip (`select 1 from trip_members where trip_id = $1 and user_id = $2 and status='accepted'`); 404 if not.
  4. **AC-2:** if `role === 'owner'`, no implicit demotion of any existing owner — the patch is a single-row UPDATE on the target member only. Multi-owner allowed.
  5. **AC-3 (no-op self-demotion guard):** if the target is the requester AND the new role is not `owner`, reject with 409 `cannot_demote_self` (defense against accidentally orphaning a single-owner trip — but only blocked when there are no OTHER owners; if another owner exists, allow it). Note: this is a stricter interpretation than R1 strictly requires (R1 only forbids self-removal); the architect adds it because demoting yourself when you are the sole owner produces an orphaned no-owner trip — a state the rest of the system assumes never occurs. **Open question for [backend-engineer]: confirm acceptable; otherwise relax to "any self-demotion allowed when another owner exists".** Recommended path: enforce the relaxed form ("only block self-demotion when sole owner") — this preserves AC-2's multi-owner semantic.
- 200: `{ member: TripMember }`.
- Audit: `member_role_updated` with `{ from_role, to_role, target_user_id }`.

**`DELETE /api/trips/[tripId]/members/[userId]`** — owner-only OR self-non-owner
- Pre-conditions:
  1. `requireAuth()`.
  2. **AC-3:** if `userId === auth.uid()` AND requester is an owner → 403 `cannot_remove_self_as_owner`. The DB-layer policy enforces the same guard (defense-in-depth).
  3. Otherwise: requester must be an owner (to remove someone else) or the target must be self (editor/viewer leaving). 403 `forbidden` if neither.
  4. Target member exists; 404 otherwise.
- 204 no body.
- Audit: `member_removed` with `{ target_user_id, target_role }` (no email).
- AC-8: ON DELETE on `auth.users` — irrelevant here; this DELETE only removes the `trip_members` row, not the user. Authored content (`itinerary_items.created_by`, `bookmarks.added_by`, `expenses.paid_by`) remains in place because those FKs reference `auth.users(id)`, not `trip_members(user_id)`. The DB-layer SET NULL only fires on `auth.users` deletion (B-013.1 cascade verification).

#### B-013.3 Validation schema (Zod)

`app/src/lib/validations/members.ts` (NEW or extend if it exists from Sprint 2):

```ts
import { z } from 'zod';

export const TripRole = z.enum(['owner', 'editor', 'viewer']);

export const MemberRoleUpdate = z.object({
  role: TripRole,
});
```

#### B-013.4 Active-session eviction (AC-9)

When a member is removed mid-session, their next API call to any trip-scoped endpoint (e.g., `GET /api/trips/[id]`) returns **403** because `is_trip_member` is now false. The frontend handles this uniformly:

**Contract:**
1. All trip-scoped client fetches go through a shared wrapper `app/src/lib/api/client.ts` (existing). The wrapper's `handleResponse` detects a 403 with `{ error: { code: 'forbidden' | 'not_a_member' } }` on a `/api/trips/[id]/...` path and:
   - Pushes a global toast: "You no longer have access to this trip."
   - Calls `router.push('/trips')` to redirect.
2. Server components that 403 on the parent trip fetch (`/trips/[id]/...` pages) return Next.js `notFound()` — AC behavior already in place from Sprint 1. The client wrapper handles in-app navigation cases (e.g., user is sitting on an open day view when their access is revoked by a parallel owner action).
3. Realtime push (Supabase Realtime on `trip_members` row deletion) is **out of scope for Sprint 3** — eviction occurs lazily on the next API call, which is acceptable per AC-9's wording "subsequent trip API calls".

**ApiErrorCode addition:** `'not_a_member'` — emitted when membership lookup returns no row mid-session (distinct from `forbidden` to give the frontend a precise eviction trigger). Frontend wrapper triggers the toast/redirect on either code for trip-scoped paths.

#### B-013.5 Audit, errors

- `AuditAction` additions: `'member_role_updated' | 'member_removed'`. Metadata never includes email; only `target_user_id`, `from_role`, `to_role` (for updates), `target_role` (for removals).
- `ApiErrorCode` additions: `'cannot_remove_self_as_owner'`, `'cannot_demote_sole_owner'`, `'not_a_member'`.

#### B-013.6 R2 Q-Checklist

| # | Check | Verdict |
|---|-------|---------|
| Q-1 | List queries bounded | YES — `GET /members` already paginated (Sprint 2 baseline §4.3). |
| Q-2 | No N+1 | YES — `GET /members` uses `select *, profile:profiles(full_name, avatar_url, email)` foreign-table join (single query). |
| Q-3 | Pagination | YES. |
| Q-4 | Date-bounded analytics | N/A — no aggregation. |

#### B-013.7 R3 files plan

Backend (`[backend-engineer]`):
- `app/supabase/migrations/0010_member_role_mgmt.sql` (NEW) + rollback. Adjusts `trip_members_delete` policy + cascade verification block.
- `app/src/app/api/trips/[tripId]/members/[userId]/route.ts` (NEW) — PATCH, DELETE.
- `app/src/app/api/trips/[tripId]/members/route.ts` — confirm GET implementation matches §4.3 (single query, paginated, joins profile).
- `app/src/lib/validations/members.ts` — add `MemberRoleUpdate` (NEW or extend).
- `app/src/lib/api/response.ts` — extend `ApiErrorCode`. **SHARED FILE** — flag for reviewer.
- `app/src/lib/audit.ts` — extend `AuditAction`. **SHARED FILE** — flag.
- `app/src/lib/api/client.ts` — extend the response handler to detect trip-scoped 403/`not_a_member` and trigger toast + redirect. **SHARED FILE** — flag.

Frontend (`[frontend-engineer]`):
- `app/src/app/trips/[id]/members/page.tsx` — extend Members tab with role-change dropdown (owner-only) and remove-member button (with `ConfirmDialog`). The owner sees their own row with a disabled "Remove" button + tooltip "Owners cannot remove themselves; delete the trip instead."
- `app/src/components/members/MemberRow.tsx` (NEW or extend) — role chip + role-change dropdown + remove button.
- `app/src/components/members/RemoveMemberDialog.tsx` (NEW) — confirm modal naming the member.
- `app/src/lib/hooks/useMembers.ts` — extend with `updateMemberRole` and `removeMember` mutations.

#### B-013.8 Performance AC

- PATCH role: P95 < 200ms (single UPDATE).
- DELETE member: P95 < 200ms (single DELETE; cascade does not fire on `auth.users`).
- GET list (existing): P95 < 500ms per AC-7.

---

### Sprint 3 — cross-cutting summary

**Migrations (forward + rollback):**
- `0008_transportation.sql` — table redesign + indexes + RLS + RPCs (`create_transport_item`, `update_transport_item`).
- `0009_accommodations.sql` — table reshape + indexes + trip-range trigger + view `trip_day_accommodation_indicators` + RLS.
- `0010_member_role_mgmt.sql` — replace `trip_members_delete` policy + cascade-regression guard.

**Shared-file edits this sprint** (sequenced by [scrum-master]):
- `app/src/lib/types/domain.ts` — adds Transportation, TransportMode, TransportationWithItem, Accommodation, AccommodationWithPlace, AccommodationIndicatorType, AccommodationDayIndicator. (B-007 + B-008.)
- `app/src/lib/api/response.ts` — adds 6 new ApiErrorCodes across the three items.
- `app/src/lib/audit.ts` — adds 8 new AuditActions across the three items.
- `app/src/lib/validations/itinerary-items.ts` — discriminated-union refactor (B-007 only).
- `app/src/lib/api/client.ts` — eviction handler (B-013).

Sequencing: B-007 backend lands its shared edits FIRST (largest delta — itinerary-items refactor); B-008 backend rebases and adds its types; B-013 backend lands last (smallest delta). All three frontends parallel after backend shared files committed.

**Breaking API changes:** none.
- `POST /api/trips/[id]/days/[dayId]/items` extends body shape additively (the `transportation` sub-object is required only when `type='transport'`; all other type variants unchanged).
- `DELETE /api/trips/[id]/members/[userId]` is a path-style addition; the Sprint-2 query-string form was never implemented.

**R2 Q-Checklist (sprint roll-up):**

| # | Check | B-007 | B-008 | B-013 |
|---|-------|-------|-------|-------|
| Q-1 | List queries bounded | YES | YES | YES |
| Q-2 | No N+1 | YES | YES (foreign join + view) | YES |
| Q-3 | Pagination on list endpoints | YES | YES | YES (existing) |
| Q-4 | Date-bounded analytics | N/A | N/A | N/A |

**Open questions for engineers:**
1. **B-007 RPCs vs client-side compensation.** Recommendation: RPCs `create_transport_item` / `update_transport_item` (atomic). [backend-engineer] to confirm during R3; if a stronger reason emerges to use Supabase Edge Functions instead, document and update this section.
2. **B-013 sole-owner self-demotion.** Recommendation: allow self-demotion only when another owner exists; otherwise 409 `cannot_demote_sole_owner`. [backend-engineer] to confirm interpretation aligns with R1 AC-2/AC-3 intent before implementing the guard.

**Deferred items (out of Sprint 3 scope, recorded for future backlog):**
- Ownership-transfer UX flow (separate backlog item).
- Realtime member-eviction push (Supabase Realtime); lazy-on-next-call eviction is acceptable for v1.
- Pending-invitation surface on Members tab (B-013 AC-10 explicitly excludes it).

---

## Sprint 4 — R2 Architecture Additions

### B-017 — Profile / Avatars (Fast Track, light R2 on Storage policy)

Auth-adjacent: a user must not be able to overwrite or delete another user's avatar. Storage RLS is the sole enforcement point.

**Bucket** (created via migration `app/supabase/migrations/0013_avatars_storage.sql`; slots 0011 = B-016 `source_card_id`, 0012 = B-014 expenses, 0013 = avatars storage, 0014 = post-R4 expense fixes):
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/jpeg','image/png','image/webp']
);
```
- `public=true` → unauthenticated GET via public URL (avatars render in member lists without signed URLs).
- `file_size_limit=2097152` → 2 MB hard cap, enforced by Storage layer.
- `allowed_mime_types` → Storage rejects any other content-type at upload time. This **is** the server-side MIME re-validation required by AC-3 (no app-layer MIME sniffing needed).

**Path convention:** `{user_id}/avatar.<ext>` (single object per user). `storage.foldername(name)[1]` resolves to the `user_id` segment.

**Storage RLS** on `storage.objects` for `bucket_id = 'avatars'`:
```sql
create policy avatars_select_public on storage.objects
  for select using (bucket_id = 'avatars');
create policy avatars_insert_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy avatars_delete_own on storage.objects
  for delete using (
    bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]
  );
```

**Replace pattern (canonical, client-side):** before uploading a new avatar, the client calls `supabase.storage.from('avatars').remove([oldPath])` if `profiles.avatar_url` is non-null; then upload new object → PATCH `profiles.avatar_url`. Keeps storage clean (AC-4) and stays within RLS (caller can only touch their own folder).

**Delete pattern (AC-6):** client calls `remove([currentPath])` then `PATCH /api/profile { avatar_url: null }`. UI renders an initials avatar component thereafter (no server work).

**Profile API contract (new, B-017):**
- `PATCH /api/profile` — auth required. Body (Zod): `{ full_name?: string (1..80, trimmed) | null, avatar_url?: string (https URL, ≤ 1024 chars) | null }`. Updates `public.profiles` for `id = auth.uid()` only. Returns `{ id, full_name, avatar_url, updated_at }`. Audit log: `profile.update`.
- Avatar bytes do NOT pass through the API — client uploads directly to Storage; only the resulting public URL is PATCHed.

**Rollback** (`*_rollback.sql`): drop the four policies, then `delete from storage.buckets where id = 'avatars'`.

**Open issues for R3:** none architectural. Final migration number landed as `0013_avatars_storage.sql`.

---

### B-016 — Trello import (one-shot script)

This subsection locks the schema delta, label-routing rules, hotel pairing logic, atomicity model, and operational guardrails for `app/scripts/import-trello.ts` — the one-shot importer that hydrates the Japan 2026 trip from `app/scripts/data/japan-2026.json` (copied from `onboarding/fWkLqBPa - japan-2026.json` at R3).

#### B-016.1 Schema delta — migration `0011_trello_import.sql`

Three table-shape changes plus one constraint relaxation. All ride a single transaction, with a sibling `0011_trello_import_rollback.sql`.

**1. Add `source_card_id text` to three tables (nullable).**

```sql
alter table public.itinerary_items add column source_card_id text;
alter table public.accommodations  add column source_card_id text;
alter table public.bookmarks       add column source_card_id text;
```

`source_card_id` stores the Trello `cards[].id` (24-hex string). Null for any row not created via the importer. UI-created rows leave it null.

**2. Per-table unique partial index (idempotency key).**

```sql
create unique index itinerary_items_trip_source_card_uniq
  on public.itinerary_items (trip_id, source_card_id)
  where source_card_id is not null;

create unique index accommodations_trip_source_card_uniq
  on public.accommodations (trip_id, source_card_id)
  where source_card_id is not null;

create unique index bookmarks_trip_source_card_uniq
  on public.bookmarks (trip_id, source_card_id)
  where source_card_id is not null;
```

`(trip_id, source_card_id)` is the upsert conflict target. Re-running the importer never duplicates rows. Trello cards reused across trips remain unique per trip.

**3. Relax `bookmarks.place_id` to nullable + add row-level guard.**

`0007_bookmarks.sql` declares `place_id uuid not null references public.places(id)`. The importer must be allowed to create bookmark rows without a Place (no Google Places API call from the script). Migration:

```sql
alter table public.bookmarks alter column place_id drop not null;

alter table public.bookmarks
  add constraint bookmarks_place_or_source_card
  check (place_id is not null or source_card_id is not null);
```

The CHECK preserves the Sprint-2 invariant for UI-created bookmarks (which never set `source_card_id` and so still must carry a `place_id`). Importer rows may have null `place_id`, but only when `source_card_id` is set.

The existing `unique (trip_id, place_id, category)` constraint must be replaced with a partial unique index — Postgres treats nulls as distinct, so the constraint becomes meaningless against importer rows but the UI-row uniqueness must still hold:

```sql
alter table public.bookmarks drop constraint bookmarks_trip_id_place_id_category_key;

create unique index bookmarks_trip_place_category_uniq
  on public.bookmarks (trip_id, place_id, category)
  where place_id is not null;
```

The `bookmarks_trip_source_card_uniq` index handles dedup for importer rows.

**4. RLS posture.** `source_card_id` is just a column — RLS is unchanged. Service-role bypass means the script writes through; the new CHECK still runs. The existing `bookmarks_insert` policy enforces `added_by = auth.uid()`; service-role bypasses RLS, so the importer sets `added_by = <owner-user-id>` for audit cleanliness.

**Rollback (`0011_trello_import_rollback.sql`):**

```sql
begin;
-- restore bookmarks unique constraint and place_id NOT NULL
drop index if exists public.bookmarks_trip_place_category_uniq;
alter table public.bookmarks drop constraint if exists bookmarks_place_or_source_card;
-- (NOTE: re-asserting place_id NOT NULL will fail if importer rows exist with null place_id;
--  rollback assumes the importer-created data has been deleted first.)
alter table public.bookmarks alter column place_id set not null;
alter table public.bookmarks
  add constraint bookmarks_trip_id_place_id_category_key
  unique (trip_id, place_id, category);
-- drop source_card_id columns + indexes
drop index if exists public.bookmarks_trip_source_card_uniq;
drop index if exists public.accommodations_trip_source_card_uniq;
drop index if exists public.itinerary_items_trip_source_card_uniq;
alter table public.bookmarks       drop column if exists source_card_id;
alter table public.accommodations  drop column if exists source_card_id;
alter table public.itinerary_items drop column if exists source_card_id;
commit;
```

The rollback's docstring must call out the prerequisite: delete importer rows first (`delete from <table> where source_card_id is not null and trip_id = '<japan-trip-uuid>'`), or `set not null` on `bookmarks.place_id` will fail.

#### B-016.2 Updated table baselines

§2.7 `itinerary_items`, §2.9 `accommodations`, §2.10 `bookmarks` each gain:

```
source_card_id text   -- Trello card id; null for non-imported rows; unique per trip when set
```

§2.10 `bookmarks` further changes: `place_id uuid` (now nullable), with CHECK `(place_id is not null or source_card_id is not null)`, and the unique key replaced with the partial index `bookmarks_trip_place_category_uniq` (UI-row scope) plus `bookmarks_trip_source_card_uniq` (importer scope).

#### B-016.3 Day mapping — script must create `trip_days` explicitly

**Correction to the R1 handoff note in SPRINT.md:** there is no automatic `trip_days` creation trigger. `0001_init.sql` ships only `tg_seed_owner_member` on `trips`. The importer therefore:

1. Creates the `trips` row (`base_currency='CHF'`, `start_date=2026-11-13`, `end_date=2026-12-08`, `created_by=<owner-uuid>`, `name='Japan 2026'`) — idempotent on `(created_by, name='Japan 2026')`.
2. Generates `trip_days` rows for every date in `[start_date, end_date]` via `insert ... select generate_series(...) on conflict (trip_id, date) do nothing`. Existing `unique (trip_id, date)` makes this safe to re-run.
3. Builds an in-memory `Map<DD.MM.YYYY, trip_day_id>` from `select id, date from trip_days where trip_id = $1`.
4. Routes each card to its list's date and looks up `day_id` from the map.

#### B-016.4 Card-type → table routing

Trello label drives table selection. Exactly one label per card is expected; multi-label cards log a warning and use the first label.

| Trello label             | Target table(s)                                    | Notes |
|--------------------------|-----------------------------------------------------|-------|
| `Transportation`         | `itinerary_items` (type=`transport`) **+** `transportation` | Mode best-effort from card-name keywords: `/flight\|fly/i`→`flight`, `/train\|shinkansen/i`→`train`, `/bus/i`→`bus`, `/ferry/i`→`ferry`, `/car\|drive/i`→`car`, else `flight` (default chosen by frequency in seed). `cost`, `carrier`, `from_location`, `to_location` left null — Trello has none. `itinerary_items.title` = card name; `transportation` row is the structured sibling. Both rows carry `source_card_id`; script writes `itinerary_items` first, then `transportation`. **Note:** there is no FK between them today — they share `source_card_id` as the linkage. |
| `Hotels`                 | `accommodations` (one row per Checkin/Checkout pair) | See B-016.5 pairing rule. The Checkin card's id is used as the row's `source_card_id` (canonical). |
| `Restaurants`            | `bookmarks` (category=`restaurant`)                 | `place_id` null; `notes` from `cards[].desc` if present (truncated to 500 chars). |
| `Museums`                | `bookmarks` (category=`museum`)                     | as above |
| `Attractions`            | `bookmarks` (category=`sight`)                      | as above |
| `Shopping`               | `bookmarks` (category=`shopping`)                   | as above |
| (none / unrecognized)    | `itinerary_items` (type=`note`)                     | Card name → `title`; `desc` → `notes`. Logged as `unlabeled` for visibility. |

Card description (`cards[].desc`) is copied to `notes` on the target row when non-empty, truncated to the column's max length (4000 for `accommodations.notes`, 500 for `bookmarks.notes`, no explicit cap for `itinerary_items.notes`).

#### B-016.5 Hotel pairing algorithm

Hotel cards follow `Checkin - <Hotel Name>` / `Checkout - <Hotel Name>` in their card `name`. Pairing:

1. Iterate all `Hotels`-labeled cards. Strip case-insensitive `^(Checkin|Checkout)\s*-\s*` prefix; trim, collapse whitespace → canonical hotel name.
2. Group by canonical name. Within each group:
   - **One Checkin + one Checkout** → emit one `accommodations` row: `hotel_name=<canonical>`, `check_in_date=<list date of Checkin>`, `check_out_date=<list date of Checkout>`, `source_card_id=<Checkin card id>`.
   - **Checkin only (no matching Checkout)** → emit row with `check_out_date = check_in_date + 1 day`, log `WARN unpaired_checkin name=<...>`.
   - **Checkout only (no matching Checkin)** → log `ERROR unpaired_checkout name=<...>`, skip. No partial row.
   - **Multiple Checkins for one name** → emit one row per Checkin, pair each with the chronologically-next Checkout for that name; remaining unpaired Checkins fall through to the +1-day default. Log `WARN multi_checkin name=<...> count=<n>`.
3. The `accommodations_within_trip` trigger (from `0009_accommodations.sql`) still applies — any inferred `check_out_date` must lie inside the trip range; otherwise the insert fails and the script logs the offending pair and continues.

#### B-016.6 Atomicity model — per-card transaction (resilient)

**Decision: option (b) — per-card upsert, each as its own write.** Rationale: a one-shot script with 165 cards has no real lock risk, but a single bad card aborting after 100 successful writes is a realistic failure mode. Per-card upsert lets the script log + skip the offender and continue; re-running upserts the rest idempotently.

Implementation pattern (Supabase JS client, service role):

```ts
for (const card of cards) {
  try {
    await supabase.from(table).upsert(row, {
      onConflict: 'trip_id,source_card_id',
      ignoreDuplicates: false,  // we want the row updated if Trello desc/name changed
    });
  } catch (e) {
    logger.error({ cardId: card.id, label, err: e.message }, 'card_skipped');
    summary.errors.push({ cardId: card.id, reason: e.message });
  }
}
```

Hotel pairs upsert as one row keyed on the Checkin's `source_card_id`; if upsert fails, only that pair is skipped.

The trip row uses idempotency key `(created_by, name='Japan 2026')`. If found, reuse `id`; otherwise insert. The script never deletes — re-runs only insert/update.

**Dry-run (`--dry-run`)**: the script computes the full plan (hotel pairs + label routing) and logs the planned writes (target table, source_card_id, key fields) without invoking `.upsert()`. Exit code 0 on success.

**Run summary**: at end of run print `created/updated/skipped/errors` counts per table plus the unpaired-hotel and unlabeled-card lists.

#### B-016.7 Service-role key handling

Script reads `SUPABASE_SERVICE_ROLE_KEY` from `app/.env.local` via `dotenv` (server-only). `app/.env.example` gains:

```
# Server-only. NEVER commit. Used by app/scripts/import-trello.ts (and any future maintenance scripts).
# RLS is bypassed by this key — only run scripts whose code you have read end-to-end.
SUPABASE_SERVICE_ROLE_KEY=
```

Script aborts with a clear error if the var is missing or appears to be the anon key (length / prefix heuristic). Also requires `NEXT_PUBLIC_SUPABASE_URL` (already in `.env.example`).

#### B-016.8 R2 Query-Performance Checklist

| # | Check | Status |
|---|-------|--------|
| Q-1 | List queries bounded | YES — point reads via `(trip_id, source_card_id)` partial unique index. The single bulk read is `select id, date from trip_days where trip_id = $1` (≤ 26 rows, indexed). |
| Q-2 | No N+1 | ACCEPTED — N upserts is intrinsic to a bulk seeder. No read-then-write loops; upserts decide insert-vs-update server-side. Documented as one-shot, not user-facing. |
| Q-3 | Pagination on list endpoints | N/A — script, not API route. |
| Q-4 | Date-bounded analytics | N/A. |

#### B-016.9 API surface

**No new API routes.** Existing routes (itinerary, transportation, accommodations, bookmarks) read/write `source_card_id` transparently — readers ignore it; UI writers never set it. Inbound Zod validations (`app/src/lib/validations/*`) explicitly `.omit({ source_card_id: true })` (or simply never declare it on the create schema) so client-supplied values are stripped. Internal row-level types used by the importer carry an optional `source_card_id?: string`.

#### B-016.10 Open issues for [backend-engineer] R3

1. **Mode default for Transportation cards** — B-016.4 picks `flight` as fallback. Confirm acceptable, or restrict `flight` to cases where the card name contains an airport code, else log + skip the `transportation` row (still create the `itinerary_items` row). Pick at R3 start.
2. **`itinerary_items.start_time`** — Trello cards have no time; importer leaves `start_time`/`end_time` null. Verify Sprint-1 day view renders null-time items.
3. **Trip currency** — script hard-codes `base_currency='CHF'` per R1 handoff. Document in script README.
4. **Audit log** — service-role bypasses RLS but any audit-log triggers still fire. Confirm there is no per-request `auth.uid()` requirement; if there is, the script either sets `request.jwt.claim.sub` via `set_config` or writes audit rows manually with `actor_id = <owner-uuid>`.

---

### Sprint 4 — Close (post-R4 final state)

This subsection is the source of truth for the as-shipped state of Sprint 4. Where it differs from B-014/B-016/B-017 R2 above, this subsection wins.

**Final migration list applied (in order):**

1. `0011_trello_import.sql` — adds `source_card_id text` + partial unique indexes on `itinerary_items`, `accommodations`, `bookmarks`; relaxes `bookmarks.place_id` to nullable behind CHECK `(place_id is not null or source_card_id is not null)`; replaces unique constraint with partial index `bookmarks_trip_place_category_uniq`. Also drops/relaxes the `transportation.mode` CHECK to `('flight','train','bus','car','ferry','other')` (Sprint 4 widening — see below). Rollback present.
2. `0012_expenses.sql` — creates `public.expenses`, `tg_expense_within_trip`, `get_trip_balances(uuid)`, RLS policies, indexes (per §2.11). Rollback present.
3. `0013_avatars_storage.sql` — creates the `avatars` Storage bucket (public, 2 MB, jpg/png/webp) plus four `storage.objects` RLS policies path-scoped to `auth.uid()::text = (storage.foldername(name))[1]`. Rollback present.
4. `0014_expense_review_fixes.sql` — **post-R4 fix-up**, added in response to [code-reviewer] / [security-reviewer] findings on B-014. Two changes: (a) introduces SQL function `public.get_trip_expense_total(p_trip_id uuid) returns numeric` (`security invoker`, `stable`, `set search_path = public`) used by `GET /api/trips/[id]/expenses` to compute `total_spent` server-side — replaces an unbounded JS-side aggregate fetch that pulled every expense row to sum in Node (potential perf cliff and a soft N+1 risk on large trips); (b) tightens `expenses_update` RLS policy with an explicit `with check (public.is_trip_member(trip_id, 'editor'))` clause — previously the policy was `using`-only, which permits a row's `trip_id` to be re-pointed at a trip the editor does not belong to. Rollback `0014_expense_review_fixes_rollback.sql` drops the function and reverts the policy to its 0012 form.

**TransportMode `'other'` reconciliation:** prior to Sprint 4 the three sources of truth disagreed — Zod allowed `'other'` while the TypeScript `TransportMode` union and the DB CHECK on `transportation.mode` did not. Sprint 4 brings them into agreement: (i) DB CHECK relaxed inside `0011_trello_import.sql` (`alter table transportation drop constraint transportation_mode_check; add ... check (mode in ('flight','train','bus','car','ferry','other'))`); (ii) `app/src/lib/types/transportation.ts` widened to include `'other'`; (iii) Zod `TransportMode` already included it. The Trello importer relies on `'other'` as the safe fallback for cards whose mode cannot be inferred from the card name.

**`avatars` bucket + `PATCH /api/profile`:** shipped exactly per B-017 R2 above. Avatar bytes never traverse the API — the client uploads directly to Storage with the user's session JWT (RLS enforces path scoping); the API route only updates `profiles.full_name` and `profiles.avatar_url`.

**Why 0014 exists (review-driven):** B-014 cleared R3 with a JS-side `total_spent` aggregator (`select amount from expenses where trip_id=...` then `reduce`). [code-reviewer] flagged it as a Q-1 violation (unbounded read) and [security-reviewer] flagged the `expenses_update` policy gap. Both were CRITICAL/HIGH, so engineers shipped 0014 before R5 rather than carry the debt. The `get_trip_expense_total` function pattern mirrors `get_trip_balances` from 0012 — `security invoker` so the caller's RLS controls visibility; `grant execute ... to authenticated`.

**Env vars (final):** `app/.env.example` documents `SUPABASE_SERVICE_ROLE_KEY` (server-only, used by `app/scripts/import-trello.ts`). No new env vars introduced beyond those listed in §8.

---

### Sprint 4 — Deferred issues (carried forward)

These were identified during Sprint 4 review/test but deliberately deferred — they do not block sprint close.

1. **`inferTransportMode` regex priority bug** — in the Trello importer's mode-inference helper, the `flight` regex (`/flight|fly/i`) is evaluated before `bus`, so a card named `"Bus to airport"` matches `flight` (because `fly` is not in the string but the order is wrong for "airport"-bearing strings) and gets imported with `mode='flight'`. Pre-flagged by [test-engineer] in the Sprint 4 R5 report. Acceptable for v1 because (a) the importer is one-shot, (b) the resulting row is manually editable in the UI, and (c) the affected card count in the Japan 2026 seed is ≤ 1. **Recommended fix next sprint:** reorder regex tests so the most specific keywords (`bus`, `ferry`, `train`) match before `flight`, or switch to a lookup table keyed on whitelisted tokens. File: `app/scripts/import-trello.ts`.
2. **B-008 AC-6 — N+1 `fromCalls` assertion** — carryover from Sprint 3. The accommodations day-indicator integration test asserts the indicator query is single-batched, but the assertion uses a loose `expect(fromCalls.length).toBeGreaterThan(0)` instead of `=== 1`. Tracked in BACKLOG.md; not a regression introduced by Sprint 4.

---

## Build Deviations

*(deviations from this R2 baseline, recorded at R7 close of each sprint)*
