-- Task 004: atomic, auditable, idempotent Fear adjustments.
--
-- The operations table remains deferred to Task 006. A Fear event therefore
-- carries its own request idempotency key; operation_id remains reserved for a
-- future compound operation link.

-- Persist the exact transition represented by each event. The backfill is
-- deterministic for any pre-feature rows because campaigns begin at Fear 0
-- and events are append-oriented.
alter table public.fear_events
  add column previous_value integer,
  add column new_value integer,
  add column idempotency_key uuid;

with running_values as (
  select
    id,
    sum(amount) over (
      partition by campaign_id
      order by created_at, id
      rows between unbounded preceding and current row
    )::integer as new_value
  from public.fear_events
)
update public.fear_events as event
set
  previous_value = running.new_value - event.amount,
  new_value = running.new_value,
  idempotency_key = gen_random_uuid()
from running_values as running
where running.id = event.id;

alter table public.fear_events
  alter column previous_value set not null,
  alter column new_value set not null,
  alter column idempotency_key set not null,
  add constraint fear_events_reason_valid
    check (char_length(btrim(reason)) between 1 and 200),
  add constraint fear_events_previous_value_valid
    check (previous_value between 0 and 12),
  add constraint fear_events_new_value_valid
    check (new_value between 0 and 12),
  add constraint fear_events_transition_valid
    check (new_value = previous_value + amount),
  add constraint fear_events_campaign_idempotency_unique
    unique (campaign_id, idempotency_key);

-- Event history is append-only. Authenticated callers read it through RLS but
-- may only create events through adjust_campaign_fear().
drop policy if exists fear_events_insert_own on public.fear_events;
drop policy if exists fear_events_update_own on public.fear_events;
drop policy if exists fear_events_delete_own on public.fear_events;
revoke insert, update, delete on public.fear_events from authenticated;

-- Prevent direct authenticated writes to cached Fear while retaining the
-- existing non-Fear campaign-state mutation surface for later focused tasks.
revoke update on public.campaign_state from authenticated;
grant update (
  current_week,
  current_cycle,
  current_cycle_day,
  campaign_phase
) on public.campaign_state to authenticated;

create or replace function public.adjust_campaign_fear(
  p_campaign_id uuid,
  p_amount integer,
  p_reason text,
  p_event_type text,
  p_idempotency_key uuid
)
returns table (
  event_id uuid,
  previous_value integer,
  new_value integer,
  change_amount integer,
  event_reason text,
  returned_event_type text,
  event_created_at timestamptz,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_previous_value integer;
  v_new_value integer;
  v_event public.fear_events%rowtype;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception using
      errcode = '22023',
      message = 'Fear change must be a non-zero integer.';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 200 then
    raise exception using
      errcode = '22023',
      message = 'Reason must contain between 1 and 200 characters.';
  end if;

  if p_event_type is null
     or p_event_type not in ('adjustment', 'correction') then
    raise exception using
      errcode = '22023',
      message = 'Fear event type must be adjustment or correction.';
  end if;

  if p_idempotency_key is null then
    raise exception using
      errcode = '22023',
      message = 'An idempotency key is required.';
  end if;

  -- The row lock serializes all Fear changes for this campaign. The ownership
  -- predicate is mandatory because this SECURITY DEFINER function bypasses RLS.
  select state.current_fear
  into v_previous_value
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

  -- Check after acquiring the campaign lock so concurrent retries cannot both
  -- apply. A repeated key returns the first committed result unchanged.
  select event.*
  into v_event
  from public.fear_events as event
  where event.campaign_id = p_campaign_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_event.amount <> p_amount
       or v_event.reason <> btrim(p_reason)
       or v_event.event_type <> p_event_type then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was already used for a different Fear adjustment.';
    end if;

    return query
      select
        v_event.id,
        v_event.previous_value,
        v_event.new_value,
        v_event.amount,
        v_event.reason,
        v_event.event_type,
        v_event.created_at,
        false;
    return;
  end if;

  v_new_value := v_previous_value + p_amount;

  if v_new_value < 0 or v_new_value > 12 then
    raise exception using
      errcode = '22003',
      message = 'Fear must remain between 0 and 12.';
  end if;

  update public.campaign_state
  set current_fear = v_new_value
  where campaign_id = p_campaign_id;

  insert into public.fear_events (
    campaign_id,
    amount,
    reason,
    event_type,
    created_by,
    created_at,
    previous_value,
    new_value,
    idempotency_key
  )
  values (
    p_campaign_id,
    p_amount,
    btrim(p_reason),
    p_event_type,
    v_user_id,
    clock_timestamp(),
    v_previous_value,
    v_new_value,
    p_idempotency_key
  )
  returning * into v_event;

  return query
    select
      v_event.id,
      v_event.previous_value,
      v_event.new_value,
      v_event.amount,
      v_event.reason,
      v_event.event_type,
      v_event.created_at,
      true;
end;
$$;

revoke all on function public.adjust_campaign_fear(uuid, integer, text, text, uuid)
  from public;
revoke all on function public.adjust_campaign_fear(uuid, integer, text, text, uuid)
  from anon;
grant execute on function public.adjust_campaign_fear(uuid, integer, text, text, uuid)
  to authenticated;
