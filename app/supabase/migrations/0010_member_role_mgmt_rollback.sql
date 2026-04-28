-- 0010_member_role_mgmt_rollback.sql  |  Sprint 3  |  B-013
--
-- Restores the Sprint-1 baseline trip_members RLS behavior:
--   - trip_members_delete: any owner OR self-delete (no owner self-delete block)
--   - trip_members_update: owner-only (no defense-in-depth column-immutability trigger)
-- Drops the SECURITY DEFINER RPC, both triggers, and the composite index.
-- After rollback: members can self-leave regardless of role; sole-owner
-- self-demote and owner self-delete protections are removed.

begin;

-- 1. Drop RPC
drop function if exists public.change_member_role(uuid, uuid, text);

-- 2. Drop triggers
drop trigger if exists tg_trip_members_block_owner_self_delete on public.trip_members;
drop function if exists public.tg_trip_members_block_owner_self_delete();

drop trigger if exists tg_trip_members_protect_immutable on public.trip_members;
drop function if exists public.tg_trip_members_protect_immutable();

-- 3. Restore Sprint-1 baseline policies

drop policy if exists trip_members_update on public.trip_members;
create policy trip_members_update on public.trip_members
  for update using (public.is_trip_member(trip_id, 'owner'));

drop policy if exists trip_members_delete on public.trip_members;
create policy trip_members_delete on public.trip_members
  for delete using (
    public.is_trip_member(trip_id, 'owner')
    or user_id = auth.uid()
  );

-- 4. Drop composite index (baseline did not have it)
drop index if exists public.trip_members_trip_role_idx;

commit;
