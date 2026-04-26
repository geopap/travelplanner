-- 0003_invitations_rollback.sql  |  Reverse of 0003_invitations.sql
-- Drops the two SECURITY DEFINER functions, the partial indexes, and the
-- revoked_at column. Idempotent.

begin;

drop function if exists public.accept_invitation(text);
drop function if exists public.get_invitation_by_token(text);

drop index if exists public.trip_invitations_active_uniq;
drop index if exists public.trip_invitations_expires_idx;

alter table public.trip_invitations drop column if exists revoked_at;

commit;
