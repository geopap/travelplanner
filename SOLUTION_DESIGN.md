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

## Build Deviations

*(deviations from this R2 baseline, recorded at R7 close of each sprint)*
