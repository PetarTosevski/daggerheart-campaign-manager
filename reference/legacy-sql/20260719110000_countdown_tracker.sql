-- Task 005: transactional, idempotent countdown creation and operation.
-- Existing countdown rows remain compatible; all Task 005 writes use the
-- security-definer functions below so cached state and history stay atomic.

alter table public.countdowns
  add column idempotency_key uuid;

create unique index countdowns_campaign_idempotency_idx
  on public.countdowns (campaign_id, idempotency_key)
  where idempotency_key is not null;

alter table public.countdown_events
  add column idempotency_key uuid,
  add column previous_status text,
  add column new_status text;

create unique index countdown_events_countdown_idempotency_idx
  on public.countdown_events (countdown_id, idempotency_key)
  where idempotency_key is not null;

alter table public.countdown_events
  add constraint countdown_events_reason_valid
    check (reason is null or char_length(btrim(reason)) between 1 and 200)
    not valid,
  add constraint countdown_events_previous_status_valid
    check (
      previous_status is null
      or previous_status in ('active', 'paused', 'completed', 'cancelled')
    )
    not valid,
  add constraint countdown_events_new_status_valid
    check (
      new_status is null
      or new_status in ('active', 'paused', 'completed', 'cancelled')
    )
    not valid;

create function public.create_campaign_countdown(
  p_campaign_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_starting_value integer,
  p_consequence text,
  p_idempotency_key uuid
)
returns table (
  countdown_id uuid,
  returned_name text,
  returned_description text,
  returned_category text,
  returned_starting_value integer,
  returned_current_value integer,
  returned_status text,
  returned_consequence text,
  countdown_created_at timestamptz,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(p_name);
  v_description text := nullif(btrim(p_description), '');
  v_category text := lower(btrim(p_category));
  v_consequence text := nullif(btrim(p_consequence), '');
  v_countdown public.countdowns%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_campaign_id is null
     or not exists (
       select 1 from public.campaigns
       where id = p_campaign_id and owner_id = v_user_id
     ) then
    raise exception using
      errcode = '42501',
      message = 'Campaign not found or access denied.';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Countdown name must contain between 1 and 100 characters.';
  end if;

  if v_category is null
     or v_category not in ('threat', 'project', 'consequence', 'other') then
    raise exception using
      errcode = '22023',
      message = 'Countdown category is not supported.';
  end if;

  if p_starting_value is null or p_starting_value <= 0 then
    raise exception using
      errcode = '22023',
      message = 'Countdown starting value must be a positive integer.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'An idempotency key is required.';
  end if;

  select countdown.*
  into v_countdown
  from public.countdowns as countdown
  where countdown.campaign_id = p_campaign_id
    and countdown.idempotency_key = p_idempotency_key;

  if found then
    if v_countdown.name <> v_name
       or v_countdown.description is distinct from v_description
       or v_countdown.category <> v_category
       or v_countdown.starting_value <> p_starting_value
       or v_countdown.consequence is distinct from v_consequence then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was already used for a different countdown.';
    end if;

    return query
      select
        v_countdown.id,
        v_countdown.name,
        v_countdown.description,
        v_countdown.category,
        v_countdown.starting_value,
        v_countdown.current_value,
        v_countdown.status,
        v_countdown.consequence,
        v_countdown.created_at,
        false;
    return;
  end if;

  insert into public.countdowns (
    campaign_id,
    name,
    description,
    category,
    direction,
    current_value,
    target_value,
    starting_value,
    status,
    visibility,
    consequence,
    idempotency_key
  )
  values (
    p_campaign_id,
    v_name,
    v_description,
    v_category,
    'down',
    p_starting_value,
    0,
    p_starting_value,
    'active',
    'gm',
    v_consequence,
    p_idempotency_key
  )
  returning * into v_countdown;

  return query
    select
      v_countdown.id,
      v_countdown.name,
      v_countdown.description,
      v_countdown.category,
      v_countdown.starting_value,
      v_countdown.current_value,
      v_countdown.status,
      v_countdown.consequence,
      v_countdown.created_at,
      true;
end;
$$;

create function public.operate_countdown(
  p_countdown_id uuid,
  p_action text,
  p_change_amount integer,
  p_reason text,
  p_idempotency_key uuid
)
returns table (
  event_id uuid,
  previous_value integer,
  new_value integer,
  change_amount integer,
  returned_event_type text,
  previous_status text,
  new_status text,
  returned_reason text,
  event_created_at timestamptz,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_action text := lower(btrim(p_action));
  v_reason text := nullif(btrim(p_reason), '');
  v_countdown public.countdowns%rowtype;
  v_event public.countdown_events%rowtype;
  v_previous_value integer;
  v_new_value integer;
  v_previous_status text;
  v_new_status text;
  v_completed_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_countdown_id is null then
    raise exception using errcode = '22023', message = 'A countdown is required.';
  end if;

  if v_action is null
     or v_action not in ('advance', 'reverse', 'pause', 'resume', 'cancel', 'correction') then
    raise exception using errcode = '22023', message = 'Countdown action is not supported.';
  end if;

  if p_change_amount is null then
    raise exception using errcode = '22023', message = 'A countdown change amount is required.';
  end if;

  if (v_action = 'advance' and p_change_amount >= 0)
     or (v_action = 'reverse' and p_change_amount <= 0)
     or (v_action = 'correction' and p_change_amount = 0)
     or (v_action in ('pause', 'resume', 'cancel') and p_change_amount <> 0) then
    raise exception using errcode = '22023', message = 'Countdown action and change amount do not match.';
  end if;

  if v_reason is not null and char_length(v_reason) > 200 then
    raise exception using errcode = '22023', message = 'Countdown reason cannot exceed 200 characters.';
  end if;

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'An idempotency key is required.';
  end if;

  select countdown.*
  into v_countdown
  from public.countdowns as countdown
  join public.campaigns as campaign on campaign.id = countdown.campaign_id
  where countdown.id = p_countdown_id
    and campaign.owner_id = v_user_id
  for update of countdown;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Countdown not found or access denied.';
  end if;

  select event.*
  into v_event
  from public.countdown_events as event
  where event.countdown_id = p_countdown_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_event.event_type <> v_action
       or v_event.change_amount <> p_change_amount
       or v_event.reason is distinct from v_reason then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was already used for a different countdown action.';
    end if;

    return query
      select
        v_event.id,
        v_event.previous_value,
        v_event.new_value,
        v_event.change_amount,
        v_event.event_type,
        v_event.previous_status,
        v_event.new_status,
        v_event.reason,
        v_event.created_at,
        false;
    return;
  end if;

  if v_countdown.status = 'cancelled' then
    raise exception using errcode = '22023', message = 'Cancelled countdowns cannot be changed.';
  end if;

  v_previous_value := v_countdown.current_value;
  v_new_value := v_previous_value;
  v_previous_status := v_countdown.status;
  v_new_status := v_previous_status;
  v_completed_at := v_countdown.completed_at;

  if v_action in ('advance', 'reverse', 'correction') then
    if v_action in ('advance', 'reverse') and v_previous_status = 'paused' then
      raise exception using errcode = '22023', message = 'Resume the countdown before changing its value.';
    end if;

    if v_previous_status = 'completed'
       and not (
         p_change_amount > 0
         and v_action in ('reverse', 'correction')
       ) then
      raise exception using errcode = '22023', message = 'A completed countdown must be reversed to reopen it.';
    end if;

    v_new_value := v_previous_value + p_change_amount;

    if v_new_value < 0 or v_new_value > v_countdown.starting_value then
      raise exception using
        errcode = '22003',
        message = 'Countdown value must remain between 0 and its starting value.';
    end if;

    if v_new_value = 0 then
      v_new_status := 'completed';
      if v_previous_status <> 'completed' then
        v_completed_at := clock_timestamp();
      end if;
    elsif v_previous_status = 'completed' then
      v_new_status := 'active';
      v_completed_at := null;
    end if;
  elsif v_action = 'pause' then
    if v_previous_status <> 'active' then
      raise exception using errcode = '22023', message = 'Only an active countdown can be paused.';
    end if;
    v_new_status := 'paused';
  elsif v_action = 'resume' then
    if v_previous_status <> 'paused' then
      raise exception using errcode = '22023', message = 'Only a paused countdown can be resumed.';
    end if;
    v_new_status := 'active';
  elsif v_action = 'cancel' then
    if v_previous_status not in ('active', 'paused') then
      raise exception using errcode = '22023', message = 'Only an active or paused countdown can be cancelled.';
    end if;
    v_new_status := 'cancelled';
  end if;

  update public.countdowns
  set current_value = v_new_value,
      status = v_new_status,
      completed_at = v_completed_at
  where id = p_countdown_id;

  insert into public.countdown_events (
    countdown_id,
    change_amount,
    event_type,
    reason,
    previous_value,
    new_value,
    previous_status,
    new_status,
    idempotency_key,
    created_by,
    created_at
  )
  values (
    p_countdown_id,
    p_change_amount,
    v_action,
    v_reason,
    v_previous_value,
    v_new_value,
    v_previous_status,
    v_new_status,
    p_idempotency_key,
    v_user_id,
    clock_timestamp()
  )
  returning * into v_event;

  return query
    select
      v_event.id,
      v_event.previous_value,
      v_event.new_value,
      v_event.change_amount,
      v_event.event_type,
      v_event.previous_status,
      v_event.new_status,
      v_event.reason,
      v_event.created_at,
      true;
end;
$$;

-- Countdown history and cached values can only be mutated through the
-- transactional functions. Existing owner RLS continues to protect reads.
revoke insert, update, delete on public.countdowns from authenticated;
revoke insert, update, delete on public.countdown_events from authenticated;

revoke all on function public.create_campaign_countdown(
  uuid, text, text, text, integer, text, uuid
) from public;
revoke all on function public.create_campaign_countdown(
  uuid, text, text, text, integer, text, uuid
) from anon;
grant execute on function public.create_campaign_countdown(
  uuid, text, text, text, integer, text, uuid
) to authenticated;

revoke all on function public.operate_countdown(
  uuid, text, integer, text, uuid
) from public;
revoke all on function public.operate_countdown(
  uuid, text, integer, text, uuid
) from anon;
grant execute on function public.operate_countdown(
  uuid, text, integer, text, uuid
) to authenticated;
