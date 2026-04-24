-- 0002_audit_log.sql  |  Sprint 1 R4 fixes
-- Adds the audit_log table referenced by app/src/lib/audit.ts.
-- Writes are performed by the service-role client and bypass RLS.
-- No policies are defined for regular users — reads and writes from a
-- user-scoped Supabase client will simply fail.

begin;

create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  trip_id     uuid references public.trips(id) on delete set null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_trip_created_idx
  on public.audit_log (trip_id, created_at desc);

create index audit_log_actor_created_idx
  on public.audit_log (actor_id, created_at desc);

-- Enable RLS with no policies → no access for anon/authenticated roles.
-- The service-role key bypasses RLS entirely and is the only writer.
alter table public.audit_log enable row level security;

commit;

-- =============================================================================
-- Rollback
-- =============================================================================
-- begin;
--   drop index if exists public.audit_log_actor_created_idx;
--   drop index if exists public.audit_log_trip_created_idx;
--   drop table if exists public.audit_log;
-- commit;
