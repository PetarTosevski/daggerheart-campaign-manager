-- Task 007: atomic, auditable, idempotent campaign-time advancement and
-- correction. Named phases remain derived presentation values and are never
-- stored as canonical campaign time.

create table public.campaign_time_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  operation_id uuid not null,
  event_type text not null,
  previous_week integer not null,
  previous_cycle text not null,
  previous_cycle_day smallint not null,
  new_week integer not null,
  new_cycle text not null,
  new_cycle_day smallint not null,
  note text,
  corrects_event_id uuid,
  created_at timestamptz not null default now(),
  constraint campaign_time_events_type_valid
    check (event_type in ('advance', 'correction')),
  constraint campaign_time_events_previous_week_valid
    check (previous_week >= 1),
  constraint campaign_time_events_previous_cycle_valid
    check (previous_cycle in ('DAY', 'NIGHT')),
  constraint campaign_time_events_previous_cycle_day_valid
    check (previous_cycle_day between 1 and 7),
  constraint campaign_time_events_new_week_valid
    check (new_week >= 1),
  constraint campaign_time_events_new_cycle_valid
    check (new_cycle in ('DAY', 'NIGHT')),
  constraint campaign_time_events_new_cycle_day_valid
    check (new_cycle_day between 1 and 7),
  constraint campaign_time_events_note_valid
    check (note is null or char_length(note) between 1 and 200),
  constraint campaign_time_events_changes_state
    check (
      previous_week <> new_week
      or previous_cycle <> new_cycle
      or previous_cycle_day <> new_cycle_day
    ),
  constraint campaign_time_events_advance_valid
    check (
      event_type <> 'advance'
      or (
        previous_cycle_day < 7
        and new_week = previous_week
        and new_cycle = previous_cycle
        and new_cycle_day = previous_cycle_day + 1
      )
      or (
        previous_cycle_day = 7
        and new_week = previous_week + 1
        and new_cycle_day = 1
        and new_cycle = case previous_cycle
          when 'DAY' then 'NIGHT'
          else 'DAY'
        end
      )
    ),
  constraint campaign_time_events_campaign_id_id_unique
    unique (campaign_id, id),
  constraint campaign_time_events_operation_unique
    unique (operation_id),
  constraint campaign_time_events_operation_same_campaign_fkey
    foreign key (campaign_id, operation_id)
    references public.operations (campaign_id, id)
    on delete restrict,
  constraint campaign_time_events_not_self_correcting
    check (corrects_event_id is null or corrects_event_id <> id)
);

alter table public.campaign_time_events
  add constraint campaign_time_events_correction_same_campaign_fkey
    foreign key (campaign_id, corrects_event_id)
    references public.campaign_time_events (campaign_id, id)
    on delete restrict;

create index campaign_time_events_campaign_created_idx
  on public.campaign_time_events (campaign_id, created_at desc, id desc);
create index campaign_time_events_corrects_event_idx
  on public.campaign_time_events (corrects_event_id)
  where corrects_event_id is not null;

alter table public.campaign_time_events enable row level security;

create policy campaign_time_events_select_own on public.campaign_time_events
  for select using (public.owns_campaign(campaign_id));

revoke all on public.campaign_time_events from anon;
revoke all on public.campaign_time_events from authenticated;
grant select on public.campaign_time_events to authenticated;

-- Campaign time is authoritative cached state. Authenticated callers may read
-- it but may change it only through change_campaign_time(). Keep the unrelated
-- campaign_phase column grant established by Task 004.
revoke update (current_week, current_cycle, current_cycle_day)
  on public.campaign_state from authenticated;

create function public.change_campaign_time(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_intent text,
  p_target_week integer default null,
  p_target_cycle text default null,
  p_target_cycle_day integer default null,
  p_note text default null,
  p_corrects_event_id uuid default null
)
returns table (
  event_id uuid,
  operation_id uuid,
  returned_event_type text,
  previous_week integer,
  previous_cycle text,
  previous_cycle_day smallint,
  new_week integer,
  new_cycle text,
  new_cycle_day smallint,
  returned_note text,
  returned_corrects_event_id uuid,
  event_created_at timestamptz,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_event_type text := lower(btrim(p_intent));
  v_target_cycle text := upper(btrim(p_target_cycle));
  v_note text := nullif(btrim(p_note), '');
  v_previous_week integer;
  v_previous_cycle text;
  v_previous_cycle_day smallint;
  v_new_week integer;
  v_new_cycle text;
  v_new_cycle_day smallint;
  v_corrected_operation_id uuid;
  v_operation_id uuid;
  v_operation_applied boolean;
  v_metadata jsonb;
  v_event public.campaign_time_events%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_campaign_id is null then
    raise exception using errcode = '22023', message = 'A campaign is required.';
  end if;

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'An idempotency key is required.';
  end if;

  if v_event_type is null or v_event_type not in ('advance', 'correction') then
    raise exception using
      errcode = '22023',
      message = 'Campaign time intent must be advance or correction.';
  end if;

  if v_note is not null and char_length(v_note) > 200 then
    raise exception using
      errcode = '22023',
      message = 'Campaign time notes cannot exceed 200 characters.';
  end if;

  if v_event_type = 'advance' then
    if p_target_week is not null
       or p_target_cycle is not null
       or p_target_cycle_day is not null
       or p_corrects_event_id is not null then
      raise exception using
        errcode = '22023',
        message = 'Advance requests cannot include correction fields.';
    end if;
  else
    if p_target_week is null or p_target_week < 1 then
      raise exception using
        errcode = '22023',
        message = 'Correction week must be an integer of at least 1.';
    end if;

    if v_target_cycle is null or v_target_cycle not in ('DAY', 'NIGHT') then
      raise exception using
        errcode = '22023',
        message = 'Correction cycle must be DAY or NIGHT.';
    end if;

    if p_target_cycle_day is null or p_target_cycle_day not between 1 and 7 then
      raise exception using
        errcode = '22023',
        message = 'Correction cycle day must be an integer from 1 through 7.';
    end if;

    if p_corrects_event_id is not null then
      select corrected.operation_id
      into v_corrected_operation_id
      from public.campaign_time_events as corrected
      where corrected.id = p_corrects_event_id
        and corrected.campaign_id = p_campaign_id;

      if not found then
        raise exception using
          errcode = '22023',
          message = 'The corrected campaign time event does not belong to this campaign.';
      end if;
    end if;
  end if;

  v_metadata := jsonb_build_object(
    'intent', v_event_type,
    'target_week', p_target_week,
    'target_cycle', case when v_event_type = 'correction' then v_target_cycle else null end,
    'target_cycle_day', p_target_cycle_day,
    'note', v_note,
    'corrects_event_id', p_corrects_event_id
  );

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_operation_applied
  from public.record_operation(
    p_campaign_id,
    p_idempotency_key,
    'campaign_time_' || v_event_type,
    case v_event_type
      when 'advance' then 'Advance one campaign day'
      else 'Correct campaign time'
    end,
    v_metadata,
    v_corrected_operation_id
  ) as recorded;

  if not v_operation_applied then
    select event.*
    into v_event
    from public.campaign_time_events as event
    where event.operation_id = v_operation_id;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'The original campaign time operation is incomplete.';
    end if;

    return query
      select
        v_event.id,
        v_event.operation_id,
        v_event.event_type,
        v_event.previous_week,
        v_event.previous_cycle,
        v_event.previous_cycle_day,
        v_event.new_week,
        v_event.new_cycle,
        v_event.new_cycle_day,
        v_event.note,
        v_event.corrects_event_id,
        v_event.created_at,
        false;
    return;
  end if;

  select
    state.current_week,
    state.current_cycle,
    state.current_cycle_day
  into
    v_previous_week,
    v_previous_cycle,
    v_previous_cycle_day
  from public.campaign_state as state
  join public.campaigns as campaign on campaign.id = state.campaign_id
  where state.campaign_id = p_campaign_id
    and campaign.owner_id = v_user_id
  for update of state;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Campaign not found or access denied.';
  end if;

  if v_event_type = 'advance' then
    if v_previous_cycle_day < 7 then
      v_new_week := v_previous_week;
      v_new_cycle := v_previous_cycle;
      v_new_cycle_day := v_previous_cycle_day + 1;
    else
      v_new_week := v_previous_week + 1;
      v_new_cycle := case v_previous_cycle
        when 'DAY' then 'NIGHT'
        else 'DAY'
      end;
      v_new_cycle_day := 1;
    end if;
  else
    v_new_week := p_target_week;
    v_new_cycle := v_target_cycle;
    v_new_cycle_day := p_target_cycle_day;
  end if;

  if v_new_week = v_previous_week
     and v_new_cycle = v_previous_cycle
     and v_new_cycle_day = v_previous_cycle_day then
    raise exception using
      errcode = '22023',
      message = 'Campaign time correction must change the current state.';
  end if;

  update public.campaign_state
  set
    current_week = v_new_week,
    current_cycle = v_new_cycle,
    current_cycle_day = v_new_cycle_day
  where campaign_id = p_campaign_id;

  insert into public.campaign_time_events (
    campaign_id,
    operation_id,
    event_type,
    previous_week,
    previous_cycle,
    previous_cycle_day,
    new_week,
    new_cycle,
    new_cycle_day,
    note,
    corrects_event_id,
    created_at
  )
  values (
    p_campaign_id,
    v_operation_id,
    v_event_type,
    v_previous_week,
    v_previous_cycle,
    v_previous_cycle_day,
    v_new_week,
    v_new_cycle,
    v_new_cycle_day,
    v_note,
    p_corrects_event_id,
    clock_timestamp()
  )
  returning * into v_event;

  return query
    select
      v_event.id,
      v_event.operation_id,
      v_event.event_type,
      v_event.previous_week,
      v_event.previous_cycle,
      v_event.previous_cycle_day,
      v_event.new_week,
      v_event.new_cycle,
      v_event.new_cycle_day,
      v_event.note,
      v_event.corrects_event_id,
      v_event.created_at,
      true;
end;
$$;

revoke all on function public.change_campaign_time(
  uuid, uuid, text, integer, text, integer, text, uuid
) from public;
revoke all on function public.change_campaign_time(
  uuid, uuid, text, integer, text, integer, text, uuid
) from anon;
grant execute on function public.change_campaign_time(
  uuid, uuid, text, integer, text, integer, text, uuid
) to authenticated;
