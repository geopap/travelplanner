-- 0004_places.sql  |  Sprint 2  |  B-009 — Google Places search proxy
--
-- Adds the `places` table that backs Google Places search (B-009),
-- place details (B-010), and bookmarks (B-011).
--
-- - RLS: SELECT for any authenticated user (places are non-sensitive,
--   shared catalog data). NO insert/update/delete policies are defined,
--   so writes flow exclusively through the service-role client in the
--   API layer.
-- - `cached_details` and `cached_at` are reserved for B-010 (Place Details
--   responses with TTL). B-009 only persists slim search-result fields.
-- Rollback: see 0004_places_rollback.sql

begin;

-- ============================================================================
-- 1. Table
-- ============================================================================

create table public.places (
  id                 uuid primary key default gen_random_uuid(),
  google_place_id    text not null unique,
  name               text not null,
  formatted_address  text,
  lat                numeric(9,6),
  lng                numeric(9,6),
  category           text not null
                       check (category in (
                         'restaurant','cafe','bar','sight','museum',
                         'shopping','hotel','transport_hub','park','other'
                       )),
  cached_details     jsonb not null default '{}'::jsonb,
  cached_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index places_category_idx on public.places (category);

-- ============================================================================
-- 2. updated_at trigger (reuses 0001_init.sql tg_set_updated_at())
-- ============================================================================

create trigger places_set_updated_at
  before update on public.places
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 3. RLS
-- ============================================================================

alter table public.places enable row level security;

-- Authenticated users may read all places (shared, non-sensitive catalog).
create policy places_select_authenticated
  on public.places
  for select
  to authenticated
  using (true);

-- No insert/update/delete policies: writes are service-role only.

commit;
