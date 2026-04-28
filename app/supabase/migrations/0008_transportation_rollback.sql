-- 0008_transportation_rollback.sql  |  Sprint 3  |  B-007 rollback
--
-- Drops everything 0008_transportation.sql created. The Sprint-0 baseline
-- shape is NOT recreated — no consumers ever existed for it.

begin;

drop function if exists public.update_transport_item(uuid, uuid, jsonb, jsonb, text);
drop function if exists public.create_transport_item(uuid, uuid, text, timestamptz, timestamptz, text, text, jsonb);

drop trigger if exists transportation_set_updated_at on public.transportation;
drop table  if exists public.transportation cascade;

commit;
