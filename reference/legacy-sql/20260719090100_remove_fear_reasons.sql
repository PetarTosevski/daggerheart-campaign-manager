-- Task 004 requirement revision: Fear adjustments no longer collect or store
-- a reason. Preserve all other transition, authorization, and idempotency
-- guarantees while removing the field from the public schema and RPC.

-- The existing function depends on fear_events.reason and must be removed
-- before dropping the column. Its replacement has a four-argument signature.
drop function if exists public.adjust_campaign_fear(
  uuid,
  integer,
  text,
  text,
  uuid
);

alter table public.fear_events
  drop constraint if exists fear_events_reason_valid,
  drop column reason;

create function public.adjust_campaign_fear(
  p_campaign_id uuid,
  p_amount integer,
  p_event_type text,
  p_idempotency_key uuid
)
returns table (
  event_id uuid,
  previous_value integer,
  new_value integer,
  change_amount integer,
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
      v_event.event_type,
      v_event.created_at,
      true;
end;
$$;

revoke all on function public.adjust_campaign_fear(uuid, integer, text, uuid)
  from public;
revoke all on function public.adjust_campaign_fear(uuid, integer, text, uuid)
  from anon;
grant execute on function public.adjust_campaign_fear(uuid, integer, text, uuid)
  to authenticated;
