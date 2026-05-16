-- 0019_import_sources_recent_url_idx.sql  |  Sprint 5  |  B-021 (R4 remediation)
--
-- Adds the composite index that backs the AC-12 duplicate-URL guard in
-- `POST /api/trips/[id]/import/extract`. The guard runs on the hot path
-- BEFORE the LLM call, so the lookup must be O(log n), not a full-trip scan.
--
-- Query shape (extract/route.ts:86-94):
--   select id from import_sources
--   where trip_id = $1
--     and source_url = $2
--     and created_at >= now() - interval '24 hours'
--   order by created_at desc
--   limit 1;
--
-- Partial index on `source_url is not null` keeps it small (raw_text imports
-- have no URL and never hit the dup-check path).
--
-- Rollback: see 0019_import_sources_recent_url_idx_rollback.sql

begin;

create index if not exists import_sources_trip_url_recent_idx
  on public.import_sources (trip_id, source_url, created_at desc)
  where source_url is not null;

commit;
