-- 0023_place_id_locked.sql  |  Sprint 7  |  B-026
-- Re-link bookmark/itinerary to correct Google place.
--
-- Adds a per-row "locked" flag to bookmarks and itinerary_items so the Trello
-- importer leaves manually re-linked rows alone, plus a SECURITY DEFINER
-- function `relink_place` that atomically swaps place_id on every matching
-- row in a trip and writes the audit_log entries inside the same transaction.

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.bookmarks
  add column if not exists place_id_locked boolean not null default false;
comment on column public.bookmarks.place_id_locked is
  'B-026: true when a user manually re-linked this bookmark to the correct Google place; Trello importer must NOT overwrite place_id on subsequent runs.';

alter table public.itinerary_items
  add column if not exists place_id_locked boolean not null default false;
comment on column public.itinerary_items.place_id_locked is
  'B-026: true when a user manually re-linked the paired bookmark; importer leaves place_id alone.';

-- ---------------------------------------------------------------------------
-- 2. Composite indexes for the relink hot path (AC 13: <500ms P95)
--    Partial WHERE place_id IS NOT NULL keeps the indexes narrow.
-- ---------------------------------------------------------------------------
create index if not exists bookmarks_trip_place_idx
  on public.bookmarks (trip_id, place_id)
  where place_id is not null;

create index if not exists itinerary_items_trip_place_idx
  on public.itinerary_items (trip_id, place_id)
  where place_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Atomic relink function — single TX, audit rows included.
-- ---------------------------------------------------------------------------
create or replace function public.relink_place(
  p_trip_id        uuid,
  p_from_place_id  uuid,
  p_to_place_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bookmark_ids uuid[];
  v_item_ids     uuid[];
  v_bk_count     int;
  v_it_count     int;
  v_actor        uuid := auth.uid();
begin
  -- Defense-in-depth: SECURITY DEFINER bypasses RLS, so enforce membership
  -- here so direct PostgREST .rpc() callers cannot mutate trips they don't
  -- belong to. Requires editor role; non-members and viewers raise 42501.
  if not public.is_trip_member(p_trip_id, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Bookmarks update
  with updated as (
    update public.bookmarks
       set place_id        = p_to_place_id,
           place_id_locked = true
     where trip_id  = p_trip_id
       and place_id = p_from_place_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_bookmark_ids from updated;
  v_bk_count := coalesce(array_length(v_bookmark_ids, 1), 0);

  -- Itinerary items update
  with updated as (
    update public.itinerary_items
       set place_id        = p_to_place_id,
           place_id_locked = true
     where trip_id  = p_trip_id
       and place_id = p_from_place_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_item_ids from updated;
  v_it_count := coalesce(array_length(v_item_ids, 1), 0);

  -- Batch audit-log inserts (one row per touched record).
  if v_bk_count > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, trip_id, metadata)
    select
      v_actor,
      'bookmark_relinked',
      'bookmark',
      id::text,
      p_trip_id,
      jsonb_build_object(
        'from_place_id', p_from_place_id,
        'to_place_id',   p_to_place_id
      )
    from unnest(v_bookmark_ids) as id;
  end if;

  if v_it_count > 0 then
    insert into public.audit_log (actor_id, action, entity, entity_id, trip_id, metadata)
    select
      v_actor,
      'itinerary_item_relinked',
      'itinerary_items',
      id::text,
      p_trip_id,
      jsonb_build_object(
        'from_place_id', p_from_place_id,
        'to_place_id',   p_to_place_id
      )
    from unnest(v_item_ids) as id;
  end if;

  return jsonb_build_object(
    'bookmarks',       v_bk_count,
    'itinerary_items', v_it_count
  );
end;
$$;

revoke all on function public.relink_place(uuid, uuid, uuid) from public;
grant execute on function public.relink_place(uuid, uuid, uuid) to authenticated;

comment on function public.relink_place(uuid, uuid, uuid) is
  'B-026: atomically swap place_id on every (trip_id, from_place_id) match in bookmarks and itinerary_items, set place_id_locked=true, and insert audit_log rows. Enforces trip editor membership in-function (defense-in-depth against direct .rpc() callers); actor_id is auth.uid() — never trust a client-supplied actor. Returns jsonb {bookmarks:int, itinerary_items:int}.';

commit;
