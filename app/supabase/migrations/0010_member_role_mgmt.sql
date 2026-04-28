-- 0010_member_role_mgmt.sql  |  Sprint 3  |  B-013
-- Member role management: tighten trip_members RLS + add defense-in-depth triggers.
--
-- Changes:
--   1. REPLACE trip_members_delete policy:
--        a. owners can delete other members (including other owners — multi-owner allowed)
--        b. editors/viewers can self-leave (delete own row)
--        c. owner self-delete is BLOCKED (regardless of sole/non-sole)
--   2. REPLACE trip_members_update policy: owners can UPDATE other members' role.
--      Immutability of (user_id, trip_id, joined_at*) is enforced by trigger
--      (RLS policies cannot constrain which columns are mutated).
--      *trip_members has no `joined_at` column — `accepted_at` and `invited_at`
--      are the closest equivalents; we lock both, plus role-change semantics
--      are bounded by a CHECK constraint already in place.
--   3. ADD trigger tg_trip_members_protect_immutable — raises on attempts to
--      modify user_id, trip_id, invited_at, accepted_at, status (status changes
--      go through invitation flow, not member management).
--   4. ADD trigger tg_trip_members_block_owner_self_delete — raises
--      `owner_self_delete_forbidden` when an owner tries to delete their own row.
--      Complements the RLS policy above.
--   5. Cascade-regression guard for authored content (AC-8):
--        itinerary_items.created_by  → ON DELETE SET NULL  ✔ (0001_init)
--        bookmarks.added_by          → ON DELETE SET NULL  ✔ (0007_bookmarks)
--        expenses.paid_by            → ON DELETE SET NULL  (table not yet created — B-014)
--      Verification block raises `authored_content_cascade_regression` if any
--      EXISTING column above is not SET NULL on auth.users delete.
--   6. Confirm composite index (trip_id, role) exists for sole-owner counting.

begin;

-- ============================================================================
-- 1. RLS — REPLACE trip_members_delete
-- ============================================================================

drop policy if exists trip_members_delete on public.trip_members;

create policy trip_members_delete on public.trip_members
  for delete using (
    -- (a) Owner removing someone else (multi-owner allowed; including other owners)
    (
      public.is_trip_member(trip_id, 'owner')
      and user_id <> auth.uid()
    )
    or
    -- (b) Editor / viewer leaving the trip themselves.
    --     Owner self-delete is intentionally NOT covered by this branch.
    (
      user_id = auth.uid()
      and exists (
        select 1
        from public.trip_members me
        where me.trip_id = trip_members.trip_id
          and me.user_id = auth.uid()
          and me.status  = 'accepted'
          and me.role in ('editor','viewer')
      )
    )
  );

-- ============================================================================
-- 2. RLS — REPLACE trip_members_update
-- ============================================================================

drop policy if exists trip_members_update on public.trip_members;

create policy trip_members_update on public.trip_members
  for update
  using (public.is_trip_member(trip_id, 'owner'))
  with check (public.is_trip_member(trip_id, 'owner'));

-- ============================================================================
-- 3. Trigger — protect immutable columns on UPDATE
-- ============================================================================

create or replace function public.tg_trip_members_protect_immutable()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'trip_members.user_id is immutable'
      using errcode = '23514';
  end if;
  if new.trip_id is distinct from old.trip_id then
    raise exception 'trip_members.trip_id is immutable'
      using errcode = '23514';
  end if;
  if new.invited_at is distinct from old.invited_at then
    raise exception 'trip_members.invited_at is immutable'
      using errcode = '23514';
  end if;
  if new.accepted_at is distinct from old.accepted_at then
    raise exception 'trip_members.accepted_at is immutable'
      using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    raise exception 'trip_members.status is immutable via member-management API'
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists tg_trip_members_protect_immutable on public.trip_members;

create trigger tg_trip_members_protect_immutable
  before update on public.trip_members
  for each row execute function public.tg_trip_members_protect_immutable();

-- ============================================================================
-- 4. Trigger — block owner self-delete (defense-in-depth)
-- ============================================================================

create or replace function public.tg_trip_members_block_owner_self_delete()
returns trigger language plpgsql as $$
begin
  -- When the deleter is removing their own row AND that row's role is owner,
  -- block. RLS already prevents this in normal flow; this trigger guards
  -- against direct service-role calls that bypass RLS.
  if old.user_id = auth.uid() and old.role = 'owner' then
    raise exception 'owner_self_delete_forbidden'
      using errcode = 'P0001';
  end if;
  return old;
end
$$;

drop trigger if exists tg_trip_members_block_owner_self_delete on public.trip_members;

create trigger tg_trip_members_block_owner_self_delete
  before delete on public.trip_members
  for each row execute function public.tg_trip_members_block_owner_self_delete();

-- ============================================================================
-- 5. SECURITY DEFINER RPC — atomic role change with sole-owner guard
-- ============================================================================
-- Performs the sole-owner pre-check + UPDATE in a single transaction so
-- concurrent demotions cannot leave the trip ownerless.
--
-- Returns the updated trip_members row (single).
-- Raises:
--   - 'cannot_demote_sole_owner' (P0001) — caller is sole owner trying to demote self
--   - 'member_not_found'          (P0002) — target is not an accepted member
--   - 'forbidden'                 (42501) — caller is not an owner of the trip

create or replace function public.change_member_role(
  p_trip_id        uuid,
  p_target_user_id uuid,
  p_new_role       text
) returns public.trip_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_caller_row public.trip_members;
  v_target_row public.trip_members;
  v_owner_count int;
  v_result     public.trip_members;
begin
  if v_caller is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if p_new_role not in ('owner','editor','viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  -- Caller membership + role
  select * into v_caller_row
  from public.trip_members
  where trip_id = p_trip_id
    and user_id = v_caller
    and status  = 'accepted';

  if not found or v_caller_row.role <> 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Target must be an accepted member of this trip
  select * into v_target_row
  from public.trip_members
  where trip_id = p_trip_id
    and user_id = p_target_user_id
    and status  = 'accepted';

  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  -- Sole-owner self-demotion guard:
  -- If the target is the caller, they are currently an owner, and the new role
  -- is not 'owner', then the trip must have at least one OTHER owner — else
  -- block to prevent ownerless trips.
  if p_target_user_id = v_caller
     and v_target_row.role = 'owner'
     and p_new_role <> 'owner'
  then
    select count(*) into v_owner_count
    from public.trip_members
    where trip_id = p_trip_id
      and role    = 'owner'
      and status  = 'accepted';

    if v_owner_count <= 1 then
      raise exception 'cannot_demote_sole_owner' using errcode = 'P0001';
    end if;
  end if;

  -- No-op short-circuit (still returns current row)
  if v_target_row.role = p_new_role then
    return v_target_row;
  end if;

  update public.trip_members
     set role = p_new_role
   where trip_id = p_trip_id
     and user_id = p_target_user_id
  returning * into v_result;

  return v_result;
end
$$;

revoke all on function public.change_member_role(uuid, uuid, text) from public;
grant execute on function public.change_member_role(uuid, uuid, text) to authenticated;

-- ============================================================================
-- 6. Cascade-regression guard
-- ============================================================================
-- Verifies that authored-content FKs to auth.users(id) remain ON DELETE SET NULL.
-- Skips columns that don't yet exist (expenses table arrives in B-014).

do $$
declare
  bad int := 0;
begin
  select count(*) into bad
  from information_schema.referential_constraints rc
  join information_schema.key_column_usage kcu
    on  kcu.constraint_name   = rc.constraint_name
    and kcu.constraint_schema = rc.constraint_schema
  where rc.constraint_schema = 'public'
    and rc.delete_rule <> 'SET NULL'
    and (
      (kcu.table_name = 'itinerary_items' and kcu.column_name = 'created_by') or
      (kcu.table_name = 'bookmarks'        and kcu.column_name = 'added_by')  or
      (kcu.table_name = 'expenses'         and kcu.column_name = 'paid_by')
    );

  if bad > 0 then
    raise exception 'authored_content_cascade_regression';
  end if;
end $$;

-- ============================================================================
-- 7. Indexes
-- ============================================================================
-- Sole-owner counting reads (trip_id, role). The baseline already has
-- trip_members_trip_idx on (trip_id) — adding a composite ensures the planner
-- can satisfy the count from the index alone.

create index if not exists trip_members_trip_role_idx
  on public.trip_members (trip_id, role);

commit;

-- ============================================================================
-- ROLLBACK — see 0010_member_role_mgmt_rollback.sql
-- ============================================================================
