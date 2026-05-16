-- 0022_transportation_flight_number_rollback.sql
--
-- Reverts 0022: drops the `flight_number` column and restores the
-- transportation → expense trigger function and the two transport RPCs
-- to their pre-0022 definitions (matching 0021 / 0008 respectively).

begin;

-- ============================================================================
-- 1. Restore `tg_transportation_to_expense` to the 0021 definition.
-- ============================================================================

create or replace function public.tg_transportation_to_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_when date;
  v_trip_start date;
begin
  if tg_op = 'DELETE' then
    delete from public.expenses
     where source_kind = 'transportation' and source_id = old.id;
    return old;
  end if;

  select start_date into v_trip_start from public.trips where id = new.trip_id;
  v_when := coalesce((new.departure_time at time zone 'utc')::date, v_trip_start);

  perform public.tg_sync_expense_from_booking(
    new.trip_id,
    'transportation',
    new.id,
    'transport',
    coalesce(
      nullif(trim(new.carrier), ''),
      initcap(new.mode) || ' transport'
    ),
    new.cost,
    new.currency,
    v_when,
    new.created_by
  );
  return new;
end;
$$;

-- ============================================================================
-- 2. Restore `create_transport_item` / `update_transport_item` to their
--    0008 definitions (no flight_number handling).
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

  insert into public.itinerary_items (
    trip_id, day_id, type, start_time, end_time, title,
    external_url, notes, cost, currency, created_by
  ) values (
    p_trip_id, p_day_id, 'transport', p_start_time, p_end_time, p_title,
    p_external_url, p_notes, null, null, v_actor
  ) returning id into v_item_id;

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
begin
  if v_actor is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if not public.is_trip_member(p_trip_id, 'editor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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

  v_day_target := nullif(p_item_patch->>'day_id', '')::uuid;
  if v_day_target is not null then
    select trip_id into v_day_trip_id
      from public.trip_days
      where id = v_day_target;
    if v_day_trip_id is null or v_day_trip_id <> p_trip_id then
      raise exception 'day_not_in_trip' using errcode = '22023';
    end if;
  end if;

  if v_will_be_trans and (
       (p_item_patch ? 'cost'     and p_item_patch->>'cost'     is not null) or
       (p_item_patch ? 'currency' and p_item_patch->>'currency' is not null)
     ) then
    raise exception 'transport_cost_on_item_forbidden' using errcode = '22023';
  end if;

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

  if v_was_transport and not v_will_be_trans then
    delete from public.transportation where itinerary_item_id = p_item_id;
    v_transport_id := null;
  elsif (not v_was_transport) and v_will_be_trans then
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
    if p_transportation is null then
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
    v_transport_id := null;
  end if;

  return jsonb_build_object(
    'item_id', p_item_id,
    'transportation_id', v_transport_id,
    'type', v_target_type
  );
end;
$$;

-- ============================================================================
-- 3. Drop the column last (after functions no longer reference it).
-- ============================================================================

alter table public.transportation
  drop column if exists flight_number;

commit;
