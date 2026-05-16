-- 0017_import_sources.sql
-- Sprint 5 / B-021 — Social media import.
--
-- Creates:
--   - enum public.import_source_type ('youtube','twitter','web','text')
--   - enum public.import_source_status ('pending','reviewed','saved','discarded')
--   - table public.import_sources (per-import traceability + extracted_json cache)
--   - bookmarks.import_source_id nullable FK back-link
--   - RLS: viewer read; editor/owner write
--
-- Reuses helper public.is_trip_member from 0001_init.sql.
-- Rollback: 0017_import_sources_rollback.sql

begin;

-- 1. Enum types
create type public.import_source_type as enum ('youtube','twitter','web','text');
create type public.import_source_status as enum ('pending','reviewed','saved','discarded');

-- 2. import_sources table
create table public.import_sources (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  created_by      uuid not null references auth.users(id) on delete restrict,
  source_url      text,
  source_type     public.import_source_type not null,
  raw_text        text not null,
  extracted_json  jsonb not null default '{}'::jsonb,
  status          public.import_source_status not null default 'pending',
  created_at      timestamptz not null default now(),
  constraint import_sources_url_or_text check (
    source_url is not null or source_type = 'text'
  )
);

create index import_sources_trip_id_idx
  on public.import_sources(trip_id, created_at desc);
create index import_sources_created_by_idx
  on public.import_sources(created_by);

-- 3. bookmarks back-link
alter table public.bookmarks
  add column import_source_id uuid
  references public.import_sources(id) on delete set null;

create index bookmarks_import_source_id_idx
  on public.bookmarks(import_source_id)
  where import_source_id is not null;

-- 4. RLS
alter table public.import_sources enable row level security;

create policy import_sources_select on public.import_sources
  for select using (public.is_trip_member(trip_id, 'viewer'));

create policy import_sources_insert on public.import_sources
  for insert with check (
    public.is_trip_member(trip_id, 'editor') and created_by = auth.uid()
  );

create policy import_sources_update on public.import_sources
  for update
  using (public.is_trip_member(trip_id, 'editor'))
  with check (public.is_trip_member(trip_id, 'editor'));

create policy import_sources_delete on public.import_sources
  for delete using (public.is_trip_member(trip_id, 'editor'));

commit;
