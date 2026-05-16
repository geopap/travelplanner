-- 0017_import_sources_rollback.sql
-- Rollback for 0017_import_sources.sql (B-021).

begin;

drop index if exists public.bookmarks_import_source_id_idx;
alter table public.bookmarks drop column if exists import_source_id;

drop table if exists public.import_sources;

drop type if exists public.import_source_status;
drop type if exists public.import_source_type;

commit;
