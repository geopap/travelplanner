-- 0019_import_sources_recent_url_idx_rollback.sql  |  Sprint 5  |  B-021
--
-- Drops the composite index added in 0019. The duplicate-URL guard still
-- works after rollback — just falls back to scanning by (trip_id, created_at).

begin;

drop index if exists public.import_sources_trip_url_recent_idx;

commit;
