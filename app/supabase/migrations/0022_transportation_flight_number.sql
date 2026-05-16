-- 0022_transportation_flight_number.sql
--
-- B-029 — Add a dedicated `flight_number` column to the `transportation`
-- table so flights can record their airline flight number (e.g. "LX160")
-- alongside the carrier (e.g. "Swiss"). When both are present the synced
-- expense description and list/detail UI render as "Carrier · LX160".
--
-- Changes:
--   1. Add nullable `flight_number text` column with CHECK length ≤ 16.
--   2. Redefine `tg_transportation_to_expense()` (from 0021) so the synced
--      expense description prefers "carrier · flight_number" when mode is
--      'flight' AND both fields are present. Falls back to the previous
--      logic (carrier, else "Initcap(mode) || ' transport'") otherwise.
--   3. Redefine `create_transport_item` and `update_transport_item` (from
--      0008) to read/write the new column from/to their jsonb payloads.
--   4. Backfill: none — existing rows simply have NULL flight_number.
--
-- ROLLBACK: see 0022_transportation_flight_number_rollback.sql.

begin;

-- ============================================================================
-- 1. Schema addition
-- ============================================================================

alter table public.transportation
  add column flight_number text
    check (flight_number is null or char_length(flight_number) <= 16);

comment on column public.transportation.flight_number is
  'Airline flight number for mode=flight (e.g. "LX160"). Free-form; max 16 chars. Nullable for non-flight modes or when unknown.';

-- ============================================================================
-- 2. Redefine transportation → expense trigger (was last set in 0021).
--    Description-building branch is the ONLY change vs 0021:
--      OLD: coalesce(nullif(trim(carrier),''), initcap(mode) || ' transport')
--      NEW: when mode='flight' and flight_number is not null and carrier is
--           not null → carrier || ' · ' || flight_number; else previous logic.
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
  v_description text;
begin
  if tg_op = 'DELETE' then
    delete from public.expenses
     where source_kind = 'transportation' and source_id = old.id;
    return old;
  end if;

  select start_date into v_trip_start from public.trips where id = new.trip_id;
  v_when := coalesce((new.departure_time at time zone 'utc')::date, v_trip_start);

  -- B-029: prefer "Carrier · FlightNo" when this is a flight row that has
  -- both fields. Otherwise behave exactly like the 0021 definition.
  if new.mode = 'flight'
     and new.flight_number is not null
     and new.carrier is not null
     and trim(new.carrier) <> '' then
    v_description := trim(new.carrier) || ' · ' || new.flight_number;
  else
    v_description := coalesce(
      nullif(trim(new.carrier), ''),
      initcap(new.mode) || ' transport'
    );
  end if;

  perform public.tg_sync_expense_from_booking(
    new.trip_id,
    'transportation',
    new.id,
    'transport',
    v_description,
    new.cost,
    new.currency,
    v_when,
    new.created_by
  );
  return new;
end;
$$;

-- ============================================================================
-- 3. Redefine create_transport_item / update_transport_item RPCs (from 0008)
--    to read flight_number out of the jsonb payload. Same signatures so
--    grants from 0008 remain valid.
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
    cost, currency, notes, flight_number, created_by
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
    nullif(p_transportation->>'flight_number', ''),
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
      cost, currency, notes, flight_number, created_by
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
      nullif(p_transportation->>'flight_number', ''),
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
        notes              = case when p_transportation ? 'notes'    then nullif(p_transportation->>'notes','')    else notes    end,
        flight_number      = case when p_transportation ? 'flight_number' then nullif(p_transportation->>'flight_number','') else flight_number end
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

commit;
