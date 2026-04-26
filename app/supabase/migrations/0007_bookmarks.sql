-- 0007_bookmarks.sql  |  Sprint 2  |  B-011 — Bookmarks
--
-- Adds the `bookmarks` table that lets trip members save Google Places
-- (cached in `places`) under a trip with a narrowed BookmarkCategory.
--
-- - Reuses helpers from 0001_init.sql: `public.is_trip_member`,
--   `public.tg_set_updated_at`.
-- - Reuses places table from 0004_places.sql.
-- - RLS: viewer+ select; editor+ insert/update/delete.
-- - Insert WITH CHECK enforces `added_by = auth.uid()` to lock provenance.
-- Rollback: see 0007_bookmarks_rollback.sql

begin;

-- ============================================================================
-- 1. Table
-- ============================================================================

create table public.bookmarks (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id)  on delete cascade,
  place_id    uuid not null references public.places(id) on delete cascade,
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

-- ============================================================================
-- 2. updated_at trigger (reuses 0001_init.sql tg_set_updated_at())
-- ============================================================================

create trigger bookmarks_set_updated_at
  before update on public.bookmarks
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 3. RLS
-- ============================================================================

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
