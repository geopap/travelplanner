-- 0008_transportation.sql  |  Sprint 3  |  B-007 — Transportation fields
--
-- Reshapes the Sprint-0 baseline `transportation` table to be a 1:1 child of
-- `itinerary_items` (rows of type='transport'), per SOLUTION_DESIGN.md §B-007.1.
-- The Sprint-0 baseline table had `trip_id` + `day_id` columns and no link to
-- `itinerary_items`. No API routes were ever shipped against that baseline, so
-- a destructive drop+recreate is safe.
--
-- Also creates two SECURITY DEFINER RPCs (`create_transport_item`,
-- `update_transport_item`) that wrap the two-row mutation in a single
-- transaction (Supabase JS cannot wrap two `.insert()` calls atomically
-- client-side — RPC is the only clean atomic path).
--
-- Reuses helpers from 0001_init.sql:
--   - public.is_trip_member(uuid, text)
--   - public.tg_set_updated_at()
--
-- ROLLBACK: see 0008_transportation_rollback.sql. The rollback drops the RPCs
-- and the table; it does NOT recreate the Sprint-0 baseline shape (no
-- consumers ever existed for it).

begin;

-- ============================================================================
-- 0. Drop legacy baseline if present (Sprint-0 had a different shape).
-- ============================================================================

drop table if exists public.transportation cascade;

-- ============================================================================
-- 1. Table
-- ============================================================================

create table public.transportation (
  id                  uuid primary key default gen_random_uuid(),
  itinerary_item_id   uuid not null unique
                        references public.itinerary_items(id) on delete cascade,
  trip_id             uuid not null
                        references public.trips(id) on delete cascade,
  mode                text not null
                        check (mode in ('flight','train','bus','car','ferry')),
  carrier             text check (carrier is null or char_length(carrier) <= 120),
  confirmation        text check (confirmation is null or char_length(confirmation) <= 80),
  departure_location  text check (departure_location is null or char_length(departure_location) <= 200),
  arrival_location    text check (arrival_location is null or char_length(arrival_location) <= 200),
  departure_time      timestamptz,
  arrival_time        timestamptz,
  cost                numeric(14,2) check (cost is null or cost >= 0),
  currency            char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes               text check (notes is null or char_length(notes) <= 2000),
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint transportation_time_order
    check (departure_time is null or arrival_time is null or arrival_time >= departure_time),
  constraint transportation_cost_currency_paired
    check ((cost is null) = (currency is null))
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

create index if not exists transportation_trip_idx
  on public.transportation (trip_id);

create index if not exists transportation_depart_idx
  on public.transportation (trip_id, departure_time nulls last);

-- ============================================================================
-- 3. updated_at trigger (reuses 0001_init.sql tg_set_updated_at())
-- ============================================================================

create trigger transportation_set_updated_at
  before update on public.transportation
  for each row execute function public.tg_set_updated_at();

-- ============================================================================
-- 4. RLS
-- ============================================================================

alter table public.transportation enable row level security;

create policy transportation_select on public.transportation
  for select using (public.is_trip_member(trip_id, 'viewer'));

create policy transportation_insert on public.transportation
  for insert with check (public.is_trip_member(trip_id, 'editor'));

create policy transportation_update on public.transportation
  for update using (public.is_trip_member(trip_id, 'editor'));

create policy transportation_delete on public.transportation
  for delete using (public.is_trip_member(trip_id, 'editor'));

-- ============================================================================
-- 5. RPC: create_transport_item
--    Atomic creation of an itinerary_items row (type='transport') + linked
--    transportation row. SECURITY DEFINER so the function owns the writes;
--    we still enforce `is_trip_member(p_trip_id, 'editor')` at the top of
--    the body to prevent privilege bypass.
-- ============================================================================

create or replace function public.create_transport_item(
  p_trip_id        uuid,
  p_day_id         uuid,
  p_title          text,
  p_start_time     timestamptz,
  p_end_time       timestamptz,
  p_notes          text,
  p_external_url   text,
  p_transportation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid := auth.uid();
  v_item_id        uuid;
  v_transport_id   uuid;
  v_day_trip_id    uuid;
  v_mode           text;
begin
  if v_actor is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if not public.is_trip_member(p_trip_id, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Verify the day belongs to the trip (defense-in-depth; URL is server-side).
  select trip_id into v_day_trip_id
    from public.trip_days
    where id = p_day_id;
  if v_day_trip_id is null or v_day_trip_id <> p_trip_id then
    raise exception 'day_not_in_trip' using errcode = '22023';
  end if;

  v_mode := p_transportation->>'mode';
  if v_mode is null then
    raise exception 'transport_mode_required' using errcode = '22023';
  end if;

  -- 1. Insert itinerary_items row. cost/currency MUST be null for transport.
  insert into public.itinerary_items (
    trip_id, day_id, type, start_time, end_time, title,
    external_url, notes, cost, currency, created_by
  ) values (
    p_trip_id, p_day_id, 'transport', p_start_time, p_end_time, p_title,
    p_external_url, p_notes, null, null, v_actor
  ) returning id into v_item_id;

  -- 2. Insert transportation row.
  insert into public.transportation (
    itinerary_item_id, trip_id, mode, carrier, confirmation,
    departure_location, arrival_location,
    departure_time, arrival_time,
    cost, currency, notes, created_by
  ) values (
    v_item_id,
    p_trip_id,
    v_mode,
    nullif(p_transportation->>'carrier', ''),
    nullif(p_transportation->>'confirmation', ''),
    nullif(p_transportation->>'departure_location', ''),
    nullif(p_transportation->>'arrival_location', ''),
    nullif(p_transportation->>'departure_time', '')::timestamptz,
    nullif(p_transportation->>'arrival_time', '')::timestamptz,
    case when p_transportation ? 'cost' and p_transportation->>'cost' is not null
         then (p_transportation->>'cost')::numeric end,
    nullif(p_transportation->>'currency', ''),
    nullif(p_transportation->>'notes', ''),
    v_actor
  ) returning id into v_transport_id;

  return jsonb_build_object(
    'item_id', v_item_id,
    'transportation_id', v_transport_id
  );
end;
$$;

revoke all on function public.create_transport_item(
  uuid, uuid, text, timestamptz, timestamptz, text, text, jsonb
) from public;
grant execute on function public.create_transport_item(
  uuid, uuid, text, timestamptz, timestamptz, text, text, jsonb
) to authenticated;

-- ============================================================================
-- 6. RPC: update_transport_item
--    Atomic update covering all three type-change cases:
--      a. Stay 'transport'   → update both rows.
--      b. Was 'transport',
--         become other type  → delete transportation row, update items.type.
--      c. Was other type,
--         become 'transport' → insert transportation row, update items.type.
--    The body parameter `p_new_type` carries the requested final type or null
--    when the type isn't changing. `p_transportation` carries the sub-payload
--    (required for cases a and c, must be null for case b).
-- ============================================================================

create or replace function public.update_transport_item(
  p_trip_id        uuid,
  p_item_id        uuid,
  p_item_patch     jsonb,
  p_transportation jsonb,
  p_new_type       text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid := auth.uid();
  v_current_type   text;
  v_current_trip   uuid;
  v_target_type    text;
  v_was_transport  boolean;
  v_will_be_trans  boolean;
  v_transport_id   uuid;
  v_day_target     uuid;
  v_day_trip_id    uuid;
  v_mode           text;
  v_set_clauses    text;
begin
  if v_actor is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if not public.is_trip_member(p_trip_id, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lock the items row for the duration of the txn.
  select type, trip_id into v_current_type, v_current_trip
    from public.itinerary_items
    where id = p_item_id
    for update;

  if v_current_type is null then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_current_trip <> p_trip_id then
    raise exception 'item_not_in_trip' using errcode = '22023';
  end if;

  v_target_type   := coalesce(p_new_type, v_current_type);
  v_was_transport := v_current_type = 'transport';
  v_will_be_trans := v_target_type = 'transport';

  -- Validate day_id move (if requested).
  v_day_target := nullif(p_item_patch->>'day_id', '')::uuid;
  if v_day_target is not null then
    select trip_id into v_day_trip_id
      from public.trip_days
      where id = v_day_target;
    if v_day_trip_id is null or v_day_trip_id <> p_trip_id then
      raise exception 'day_not_in_trip' using errcode = '22023';
    end if;
  end if;

  -- AC-10: cost/currency must NEVER be set on the items row when the
  -- (post-update) type is 'transport'.
  if v_will_be_trans and (
       (p_item_patch ? 'cost'     and p_item_patch->>'cost'     is not null) or
       (p_item_patch ? 'currency' and p_item_patch->>'currency' is not null)
     ) then
    raise exception 'transport_cost_on_item_forbidden' using errcode = '22023';
  end if;

  -- Update the itinerary_items row. We apply only the keys actually present
  -- in the patch payload, plus `type` if changing.
  update public.itinerary_items set
    type         = v_target_type,
    day_id       = case when p_item_patch ? 'day_id'       then nullif(p_item_patch->>'day_id','')::uuid       else day_id       end,
    title        = case when p_item_patch ? 'title'        then p_item_patch->>'title'                          else title        end,
    start_time   = case when p_item_patch ? 'start_time'   then nullif(p_item_patch->>'start_time','')::timestamptz else start_time end,
    end_time     = case when p_item_patch ? 'end_time'     then nullif(p_item_patch->>'end_time','')::timestamptz   else end_time   end,
    external_url = case when p_item_patch ? 'external_url' then nullif(p_item_patch->>'external_url','')        else external_url end,
    notes        = case when p_item_patch ? 'notes'        then nullif(p_item_patch->>'notes','')               else notes        end,
    cost         = case
                     when v_will_be_trans then null
                     when p_item_patch ? 'cost' then nullif(p_item_patch->>'cost','')::numeric
                     else cost
                   end,
    currency     = case
                     when v_will_be_trans then null
                     when p_item_patch ? 'currency' then nullif(p_item_patch->>'currency','')
                     else currency
                   end
    where id = p_item_id;

  -- Type-change handling for the linked transportation row.
  if v_was_transport and not v_will_be_trans then
    -- Case b: removing transport type → delete the linked row (CASCADE would
    -- not fire since we're not deleting the item; remove explicitly).
    delete from public.transportation where itinerary_item_id = p_item_id;
    v_transport_id := null;
  elsif (not v_was_transport) and v_will_be_trans then
    -- Case c: adding transport type → insert.
    if p_transportation is null then
      raise exception 'transport_payload_required' using errcode = '22023';
    end if;
    v_mode := p_transportation->>'mode';
    if v_mode is null then
      raise exception 'transport_mode_required' using errcode = '22023';
    end if;
    insert into public.transportation (
      itinerary_item_id, trip_id, mode, carrier, confirmation,
      departure_location, arrival_location,
      departure_time, arrival_time,
      cost, currency, notes, created_by
    ) values (
      p_item_id,
      p_trip_id,
      v_mode,
      nullif(p_transportation->>'carrier', ''),
      nullif(p_transportation->>'confirmation', ''),
      nullif(p_transportation->>'departure_location', ''),
      nullif(p_transportation->>'arrival_location', ''),
      nullif(p_transportation->>'departure_time', '')::timestamptz,
      nullif(p_transportation->>'arrival_time', '')::timestamptz,
      case when p_transportation ? 'cost' and p_transportation->>'cost' is not null
           then (p_transportation->>'cost')::numeric end,
      nullif(p_transportation->>'currency', ''),
      nullif(p_transportation->>'notes', ''),
      v_actor
    ) returning id into v_transport_id;
  elsif v_will_be_trans then
    -- Case a: stay transport → patch the existing transportation row from
    -- whichever subset of keys the caller provided.
    if p_transportation is null then
      -- Allow no-op (item-only patch) when the type isn't changing; the
      -- transportation row simply isn't touched.
      select id into v_transport_id
        from public.transportation
        where itinerary_item_id = p_item_id;
    else
      update public.transportation set
        mode               = case when p_transportation ? 'mode'               then p_transportation->>'mode'                       else mode               end,
        carrier            = case when p_transportation ? 'carrier'            then nullif(p_transportation->>'carrier','')          else carrier            end,
        confirmation       = case when p_transportation ? 'confirmation'       then nullif(p_transportation->>'confirmation','')     else confirmation       end,
        departure_location = case when p_transportation ? 'departure_location' then nullif(p_transportation->>'departure_location','') else departure_location end,
        arrival_location   = case when p_transportation ? 'arrival_location'   then nullif(p_transportation->>'arrival_location','')   else arrival_location   end,
        departure_time     = case when p_transportation ? 'departure_time'     then nullif(p_transportation->>'departure_time','')::timestamptz else departure_time end,
        arrival_time       = case when p_transportation ? 'arrival_time'       then nullif(p_transportation->>'arrival_time','')::timestamptz   else arrival_time   end,
        cost               = case
                               when p_transportation ? 'cost' then
                                 case when p_transportation->>'cost' is null
                                      then null
                                      else (p_transportation->>'cost')::numeric end
                               else cost
                             end,
        currency           = case when p_transportation ? 'currency' then nullif(p_transportation->>'currency','') else currency end,
        notes              = case when p_transportation ? 'notes'    then nullif(p_transportation->>'notes','')    else notes    end
        where itinerary_item_id = p_item_id
        returning id into v_transport_id;
    end if;
  else
    -- Neither was nor will be transport → no transportation row touched.
    v_transport_id := null;
  end if;

  return jsonb_build_object(
    'item_id', p_item_id,
    'transportation_id', v_transport_id,
    'type', v_target_type
  );
end;
$$;

revoke all on function public.update_transport_item(
  uuid, uuid, jsonb, jsonb, text
) from public;
grant execute on function public.update_transport_item(
  uuid, uuid, jsonb, jsonb, text
) to authenticated;

commit;
