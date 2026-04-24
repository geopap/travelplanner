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

### 2.11 `expenses`

```sql
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  day_id       uuid references public.trip_days(id) on delete set null,
  category     text not null,
  description  text,
  amount       numeric(14,2) not null check (amount >= 0),
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  paid_by      uuid references auth.users(id) on delete set null,
  split_among  jsonb not null default '[]'::jsonb,   -- [{ user_id, share_pct }, …]
  receipt_url  text,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index expenses_trip_idx    on public.expenses (trip_id);
create index expenses_day_idx     on public.expenses (day_id);
create index expenses_occurred_idx on public.expenses (trip_id, occurred_at);
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.tg_set_updated_at();

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

### 4.9 Expenses

| Method | Path | Role | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/trips/[id]/expenses` | viewer+ | `page`, `limit`, optional `from`, `to`, `category` | `{ items, total, totals: { by_currency: Record<string,number>, by_category: Record<string,number> } }` | 401, 404 |
| POST | `/api/trips/[id]/expenses` | editor+ | `ExpenseCreate` | `201 { expense }` | 400, 403, 404 |
| PATCH | `/api/trips/[id]/expenses/[id]` | editor+ | partial | `{ expense }` | 400, 403, 404 |
| DELETE | `/api/trips/[id]/expenses/[id]` | editor+ | — | `204` | 403, 404 |

Totals query is date-bounded (required `from`/`to` when `totals=true` param is set) — **R2 Q-4**.

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

## Build Deviations

*(deviations from this R2 baseline, recorded at R7 close of each sprint)*
