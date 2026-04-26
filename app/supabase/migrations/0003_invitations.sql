-- 0003_invitations.sql  |  Sprint 2  |  B-012 — Trip member invite & accept
--
-- Additive migration on top of 0001_init.sql:
--   - ADD column trip_invitations.revoked_at
--   - ADD partial indexes on trip_invitations
--   - ADD function get_invitation_by_token(p_token text)        -- public lookup, anti-enumeration
--   - ADD function accept_invitation(p_token text)              -- atomic, idempotent acceptance
-- Rollback: see 0003_invitations_rollback.sql

begin;

-- ============================================================================
-- 1. Schema additions on trip_invitations
-- ============================================================================

alter table public.trip_invitations
  add column if not exists revoked_at timestamptz;

-- Index for efficient expiry sweeps and "pending" filter on owner-side listing.
create index if not exists trip_invitations_expires_idx
  on public.trip_invitations (expires_at)
  where accepted_at is null and revoked_at is null;

-- Prevent multiple active (non-accepted, non-revoked) invitations for the same
-- (trip, email) pair. Email compared case-insensitively.
create unique index if not exists trip_invitations_active_uniq
  on public.trip_invitations (trip_id, lower(email))
  where accepted_at is null and revoked_at is null;

-- ============================================================================
-- 2. get_invitation_by_token — public lookup, uniform shape, anti-enumeration
-- ============================================================================
--
-- Returns a single row with one of these statuses:
--   'pending'  | 'expired' | 'used' | 'revoked' | 'invalid'
--
-- For 'invalid' (token not found) only `status` is meaningful; all other fields
-- are null. This prevents distinguishing "no such token" from any other state
-- via timing or shape. Trip / inviter names are returned only for 'pending'.

create or replace function public.get_invitation_by_token(p_token text)
returns table (
  status        text,
  trip_id       uuid,
  trip_name     text,
  inviter_name  text,
  email         text,
  role          text,
  expires_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_inv  public.trip_invitations%rowtype;
  v_trip_name    text;
  v_inviter_name text;
  v_status       text;
begin
  if p_token is null or length(p_token) = 0 then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  select * into v_inv
    from public.trip_invitations
   where token = p_token
   limit 1;

  if not found then
    return query select 'invalid'::text, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_inv.revoked_at is not null then
    v_status := 'revoked';
  elsif v_inv.accepted_at is not null then
    v_status := 'used';
  elsif v_inv.expires_at <= now() then
    v_status := 'expired';
  else
    v_status := 'pending';
  end if;

  if v_status = 'pending' then
    select t.name into v_trip_name from public.trips t where t.id = v_inv.trip_id;
    select coalesce(p.full_name, p.email) into v_inviter_name
      from public.profiles p where p.id = v_inv.created_by;

    return query select
      v_status,
      v_inv.trip_id,
      v_trip_name,
      v_inviter_name,
      v_inv.email,
      v_inv.role,
      v_inv.expires_at;
  else
    -- Non-pending: return status only; do not leak trip / inviter / email.
    return query select v_status, null::uuid, null::text, null::text, null::text, null::text, null::timestamptz;
  end if;
end;
$$;

revoke all on function public.get_invitation_by_token(text) from public;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- ============================================================================
-- 3. accept_invitation — atomic, idempotent
-- ============================================================================
--
-- - Requires auth.uid() (raises 'unauthenticated' otherwise).
-- - Locks the invitation row FOR UPDATE to serialize concurrent acceptances.
-- - Idempotent: if the caller is already an accepted member of the trip, the
--   call still succeeds and marks the invitation as used (when not already).
-- - Raises postgres exceptions with codes mapped by the API layer:
--     'token_invalid'   — no such token / empty
--     'token_expired'   — past expires_at
--     'token_used'      — accepted_at already set (by another user)
--     'token_revoked'   — revoked_at set
--     'unauthenticated' — auth.uid() is null
--
-- Returns (trip_id, role) for the accepted membership.

create or replace function public.accept_invitation(p_token text)
returns table (trip_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_inv     public.trip_invitations%rowtype;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = 'P0001';
  end if;
  if p_token is null or length(p_token) = 0 then
    raise exception 'token_invalid' using errcode = 'P0001';
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
    -- Idempotent path: same user re-accepting is a no-op success.
    if v_inv.accepted_by_user_id = v_user_id then
      return query select v_inv.trip_id, v_inv.role;
      return;
    end if;
    raise exception 'token_used' using errcode = 'P0001';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'token_expired' using errcode = 'P0001';
  end if;

  -- Idempotent member upsert: if user is already a member, keep their existing
  -- row (do not downgrade an owner/editor); otherwise insert as the invited role.
  insert into public.trip_members(trip_id, user_id, role, status, invited_by, invited_at, accepted_at)
  values (v_inv.trip_id, v_user_id, v_inv.role, 'accepted', v_inv.created_by, v_inv.created_at, now())
  on conflict (trip_id, user_id) do update
    set status      = 'accepted',
        accepted_at = coalesce(public.trip_members.accepted_at, now());

  update public.trip_invitations
     set accepted_at         = now(),
         accepted_by_user_id = v_user_id
   where id = v_inv.id;

  return query
    select tm.trip_id, tm.role
      from public.trip_members tm
     where tm.trip_id = v_inv.trip_id and tm.user_id = v_user_id
     limit 1;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

commit;
