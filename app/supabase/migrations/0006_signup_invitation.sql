-- 0006_signup_invitation.sql  |  Sprint 2  |  B-019 — Invitation-only sign-up
--
-- Additive migration on top of 0003_invitations.sql:
--   - ADD function signup_consume_invitation(p_token text, p_email text, p_user_id uuid)
--
-- Unlike accept_invitation() (which depends on auth.uid()), this RPC is
-- explicitly designed to be called from the server-side sign-up route via
-- the service-role client BEFORE the freshly created user has signed in.
-- It atomically:
--   1. Locks the invitation row FOR UPDATE.
--   2. Validates state (not invalid/expired/used/revoked).
--   3. Enforces lower(invitation.email) = lower(p_email) — defense-in-depth
--      mirror of the route-layer check (TOCTOU guard).
--   4. Inserts/updates trip_members (idempotent, role-preserving on conflict).
--   5. Marks the invitation accepted_at + accepted_by_user_id.
--
-- All failure modes raise SQLSTATE P0001 with distinct messages mappable by
-- the API layer:
--   'arg_invalid'     — null/empty inputs
--   'token_invalid'   — no such token
--   'token_revoked'   — revoked_at set
--   'token_used'      — accepted_at already set (lost race / replay)
--   'token_expired'   — past expires_at
--   'email_mismatch'  — submitted email ≠ invitation email (case-insensitive)
--
-- Returns (trip_id uuid, role text) for the consumed membership.
--
-- Rollback: see comment block at end of file (and 0006_signup_invitation_rollback.sql sibling).

begin;

create or replace function public.signup_consume_invitation(
  p_token   text,
  p_email   text,
  p_user_id uuid
)
returns table (trip_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.trip_invitations%rowtype;
begin
  if p_token is null or length(p_token) = 0
     or p_email is null or length(p_email) = 0
     or p_user_id is null then
    raise exception 'arg_invalid' using errcode = 'P0001';
  end if;

  -- Serialize concurrent acceptances of the same token.
  select * into v_inv
    from public.trip_invitations
   where token = p_token
   for update;

  if not found then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;

  if v_inv.revoked_at is not null then
    raise exception 'token_revoked' using errcode = 'P0001';
  end if;

  if v_inv.accepted_at is not null then
    raise exception 'token_used' using errcode = 'P0001';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'token_expired' using errcode = 'P0001';
  end if;

  if lower(v_inv.email) <> lower(p_email) then
    raise exception 'email_mismatch' using errcode = 'P0001';
  end if;

  -- Idempotent member upsert: preserve any existing higher-privileged role
  -- (do NOT downgrade an owner/editor to the invited role).
  insert into public.trip_members(
    trip_id, user_id, role, status, invited_by, invited_at, accepted_at
  )
  values (
    v_inv.trip_id, p_user_id, v_inv.role, 'accepted',
    v_inv.created_by, v_inv.created_at, now()
  )
  on conflict (trip_id, user_id) do update
    set status      = 'accepted',
        accepted_at = coalesce(public.trip_members.accepted_at, now()),
        -- preserve higher existing role
        role = case
          when public.trip_members.role = 'owner'  then 'owner'
          when public.trip_members.role = 'editor' and excluded.role = 'viewer' then 'editor'
          else excluded.role
        end;

  update public.trip_invitations
     set accepted_at         = now(),
         accepted_by_user_id = p_user_id
   where id = v_inv.id;

  return query
    select tm.trip_id, tm.role
      from public.trip_members tm
     where tm.trip_id = v_inv.trip_id and tm.user_id = p_user_id
     limit 1;
end;
$$;

revoke all on function public.signup_consume_invitation(text, text, uuid) from public;
-- Service-role only — never callable by anon/authenticated. The signup route
-- invokes this via the service client; no client path exists.
revoke execute on function public.signup_consume_invitation(text, text, uuid) from anon, authenticated;

commit;

-- ============================================================================
-- ROLLBACK (also in 0006_signup_invitation_rollback.sql)
-- ============================================================================
-- begin;
-- drop function if exists public.signup_consume_invitation(text, text, uuid);
-- commit;
-- ============================================================================
