-- 0006_signup_invitation_rollback.sql  |  B-019 rollback
begin;
drop function if exists public.signup_consume_invitation(text, text, uuid);
commit;
