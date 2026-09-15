-- Task 012 follow-up: GM batch-selection override for weekly food processing.
--
-- FIFO remains the default. This migration lets a GM explicitly select WHICH
-- eligible batches are consumed and in WHAT order, as an audited, reason-gated
-- override. It:
--   * adds audit columns to food_week_processes recording whether a custom
--     selection was used, the submitted ordered ids, and an immutable per-batch
--     consumption snapshot (effective order + consumed portions, incl. zeros);
--   * replaces process_weekly_food with a variant taking p_selected_batch_ids
--     uuid[]. When null, behavior is byte-for-byte the original FIFO path. When
--     provided, only the listed batches are consumed, in the listed order, after
--     independent server-side validation under row locks.
--
-- Idempotency, ownership, locking, spoilage, and shortage handling are unchanged.

-- ---------------------------------------------------------------------------
-- Audit columns
-- ---------------------------------------------------------------------------

alter table public.food_week_processes
  add column used_custom_selection boolean not null default false,
  add column selected_batch_ids jsonb,
  add column selection_detail jsonb;

alter table public.food_week_processes
  add constraint food_week_processes_selection_ids_array
    check (selected_batch_ids is null or jsonb_typeof(selected_batch_ids) = 'array'),
  add constraint food_week_processes_selection_detail_array
    check (selection_detail is null or jsonb_typeof(selection_detail) = 'array'),
  -- A custom selection is always an override and always records its ids.
  add constraint food_week_processes_custom_selection_consistent
    check (
      not used_custom_selection
      or (used_override and selected_batch_ids is not null)
    );

comment on column public.food_week_processes.used_custom_selection is
  'True when the GM overrode default FIFO with an explicit ordered batch selection.';
comment on column public.food_week_processes.selected_batch_ids is
  'Submitted ordered batch ids for a custom selection (jsonb array), else null.';
comment on column public.food_week_processes.selection_detail is
  'Immutable per-batch consumption snapshot: [{batch_id, position, consumed_portions}], else null.';

-- ---------------------------------------------------------------------------
-- process_weekly_food (now with optional explicit ordered batch selection)
-- ---------------------------------------------------------------------------

-- Drop the original 6-argument version; the app now always calls the 7-arg form.
drop function if exists public.process_weekly_food(uuid, uuid, integer, integer, boolean, text);

create function public.process_weekly_food(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_target_week integer default null,
  p_override_required_portions integer default null,
  p_skip_spoilage boolean default false,
  p_reason text default null,
  p_selected_batch_ids uuid[] default null
)
returns table (
  process_id uuid,
  operation_id uuid,
  returned_processed_week integer,
  returned_active_character_count integer,
  returned_default_required integer,
  returned_applied_required integer,
  returned_spoiled integer,
  returned_consumed integer,
  returned_shortage integer,
  returned_used_override boolean,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_week integer;
  v_ppc integer;
  v_policy text;
  v_roster jsonb;
  v_count integer;
  v_default_required integer;
  v_applied_required integer;
  v_used_override boolean;
  v_skip_spoilage boolean := coalesce(p_skip_spoilage, false);
  v_use_selection boolean := p_selected_batch_ids is not null;
  v_spoiled integer := 0;
  v_consumed integer := 0;
  v_shortage integer;
  v_available integer;
  v_needed integer;
  v_take integer;
  v_operation_id uuid;
  v_applied boolean;
  v_batch record;
  v_sel record;
  v_selection_detail jsonb := null;
  v_selected_json jsonb := null;
  v_distinct_count integer;
  v_process public.food_week_processes%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Campaign and idempotency key are required.';
  end if;

  v_used_override := (p_override_required_portions is not null) or v_skip_spoilage or v_use_selection;
  if v_used_override and v_reason is null then
    raise exception using errcode = '22023', message = 'An override requires a reason.';
  end if;
  if p_override_required_portions is not null and p_override_required_portions < 0 then
    raise exception using errcode = '22023', message = 'Override required portions cannot be negative.';
  end if;

  -- Lock authoritative campaign state; also authorizes ownership.
  select coalesce(p_target_week, state.current_week), settings.portions_per_active_character_per_week,
         settings.default_spoilage_policy
  into v_week, v_ppc, v_policy
  from public.campaign_state as state
  join public.campaigns as campaign on campaign.id = state.campaign_id
  join public.food_settings as settings on settings.campaign_id = state.campaign_id
  where state.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of state, settings;

  if not found then
    raise exception using errcode = '42501', message = 'Campaign not found or access denied.';
  end if;
  if v_week < 1 then
    raise exception using errcode = '22023', message = 'Target week must be at least 1.';
  end if;

  -- Idempotency first: a genuine retry (same key + same input) returns the
  -- original result without re-processing or tripping the duplicate-week guard.
  -- A reused key with a changed selection/order/reason fails inside record_operation.
  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'food_weekly_process',
    'Process weekly food',
    jsonb_build_object('target_week', v_week, 'override_required', p_override_required_portions,
                       'skip_spoilage', v_skip_spoilage,
                       'selected_batch_ids', to_jsonb(p_selected_batch_ids))
  ) as recorded;

  if not v_applied then
    select * into v_process
    from public.food_week_processes as fwp
    where fwp.operation_id = v_operation_id;
    return query select v_process.id, v_process.operation_id, v_process.processed_week,
      v_process.active_character_count, v_process.default_required_portions,
      v_process.applied_required_portions, v_process.spoiled_portions,
      v_process.consumed_portions, v_process.shortage_portions, v_process.used_override, false;
    return;
  end if;

  -- A NEW standard operation may not re-process an already-processed week.
  -- Overrides (including custom selection) are a deliberate, separate workflow.
  if not v_used_override and exists (
    select 1 from public.food_week_processes
    where campaign_id = p_campaign_id and processed_week = v_week and not used_override
  ) then
    raise exception using errcode = '22023',
      message = 'This campaign week has already been processed.';
  end if;

  -- Active roster snapshot (never hard-coded; derived from status='active').
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb), count(*)
  into v_roster, v_count
  from public.characters as c
  where c.campaign_id = p_campaign_id and c.status = 'active';

  v_default_required := v_count * v_ppc;
  v_applied_required := coalesce(p_override_required_portions, v_default_required);

  -- 1-2. Spoilage: fresh batches eligible when target_week >= acquired_week + 2.
  if not v_skip_spoilage and v_policy = 'spoil_fresh' then
    for v_batch in
      select * from public.food_batches
      where campaign_id = p_campaign_id and status = 'active'
        and food_type = 'fresh' and remaining_portions > 0
        and v_week >= acquired_week + 2
      for update
    loop
      insert into public.food_transactions (
        campaign_id, batch_id, operation_id, transaction_type,
        portions_delta, before_portions, after_portions, reason, created_by
      ) values (
        p_campaign_id, v_batch.id, v_operation_id, 'spoil',
        -v_batch.remaining_portions, v_batch.remaining_portions, 0, v_reason, v_user_id
      );
      update public.food_batches
      set remaining_portions = 0, status = 'spoiled'
      where id = v_batch.id;
      v_spoiled := v_spoiled + v_batch.remaining_portions;
    end loop;
  end if;

  -- 3-4. Consume required portions. Custom selection consumes ONLY the listed
  -- batches, in the listed order; otherwise FIFO across all active batches.
  v_needed := v_applied_required;
  if v_use_selection then
    if array_length(p_selected_batch_ids, 1) is null then
      raise exception using errcode = '22023',
        message = 'Select at least one batch for a custom selection.';
    end if;
    select count(distinct u) into v_distinct_count from unnest(p_selected_batch_ids) as u;
    if v_distinct_count <> array_length(p_selected_batch_ids, 1) then
      raise exception using errcode = '22023', message = 'A batch can only be selected once.';
    end if;

    v_available := 0;
    v_selection_detail := '[]'::jsonb;
    for v_sel in
      select s.batch_id, s.ord
      from unnest(p_selected_batch_ids) with ordinality as s(batch_id, ord)
      order by s.ord
    loop
      -- Validate each selected batch under a row lock: same campaign, active,
      -- with portions remaining after any spoilage above.
      select * into v_batch
      from public.food_batches
      where campaign_id = p_campaign_id and id = v_sel.batch_id
      for update;
      if not found or v_batch.status <> 'active' or v_batch.remaining_portions <= 0 then
        raise exception using errcode = '22023',
          message = 'A selected batch is not an available, consumable batch. Refresh and try again.';
      end if;

      v_available := v_available + v_batch.remaining_portions;
      v_take := least(v_batch.remaining_portions, greatest(v_needed, 0));
      if v_take > 0 then
        insert into public.food_transactions (
          campaign_id, batch_id, operation_id, transaction_type,
          portions_delta, before_portions, after_portions, reason, created_by
        ) values (
          p_campaign_id, v_batch.id, v_operation_id, 'consume',
          -v_take, v_batch.remaining_portions, v_batch.remaining_portions - v_take, v_reason, v_user_id
        );
        update public.food_batches
        set remaining_portions = remaining_portions - v_take,
            status = case when remaining_portions - v_take = 0 then 'depleted' else status end
        where id = v_batch.id;
        v_consumed := v_consumed + v_take;
        v_needed := v_needed - v_take;
      end if;

      v_selection_detail := v_selection_detail || jsonb_build_object(
        'batch_id', v_batch.id, 'position', v_sel.ord, 'consumed_portions', v_take
      );
    end loop;
    v_selected_json := to_jsonb(p_selected_batch_ids);
  else
    -- Available after spoilage across all active batches (FIFO shortage basis).
    select coalesce(sum(remaining_portions), 0) into v_available
    from public.food_batches
    where campaign_id = p_campaign_id and status = 'active' and remaining_portions > 0;

    if v_needed > 0 then
      for v_batch in
        select * from public.food_batches
        where campaign_id = p_campaign_id and status = 'active' and remaining_portions > 0
        order by acquired_week, created_at, id
        for update
      loop
        exit when v_needed <= 0;
        v_take := least(v_batch.remaining_portions, v_needed);
        insert into public.food_transactions (
          campaign_id, batch_id, operation_id, transaction_type,
          portions_delta, before_portions, after_portions, reason, created_by
        ) values (
          p_campaign_id, v_batch.id, v_operation_id, 'consume',
          -v_take, v_batch.remaining_portions, v_batch.remaining_portions - v_take,
          case when v_used_override then v_reason else null end, v_user_id
        );
        update public.food_batches
        set remaining_portions = remaining_portions - v_take,
            status = case when remaining_portions - v_take = 0 then 'depleted' else status end
        where id = v_batch.id;
        v_consumed := v_consumed + v_take;
        v_needed := v_needed - v_take;
      end loop;
    end if;
  end if;

  -- 5. Shortage against the supply that was actually eligible for consumption.
  v_shortage := greatest(0, v_applied_required - v_available);

  -- 6. Persist the process audit.
  insert into public.food_week_processes (
    campaign_id, operation_id, processed_week, roster_snapshot, active_character_count,
    default_required_portions, applied_required_portions, spoiled_portions,
    consumed_portions, shortage_portions, used_override, override_reason, created_by,
    used_custom_selection, selected_batch_ids, selection_detail
  )
  values (
    p_campaign_id, v_operation_id, v_week, v_roster, v_count,
    v_default_required, v_applied_required, v_spoiled,
    v_consumed, v_shortage, v_used_override,
    case when v_used_override then v_reason else null end, v_user_id,
    v_use_selection, v_selected_json, v_selection_detail
  )
  returning * into v_process;

  return query select v_process.id, v_process.operation_id, v_process.processed_week,
    v_process.active_character_count, v_process.default_required_portions,
    v_process.applied_required_portions, v_process.spoiled_portions,
    v_process.consumed_portions, v_process.shortage_portions, v_process.used_override, true;
end;
$$;

revoke all on function public.process_weekly_food(uuid, uuid, integer, integer, boolean, text, uuid[]) from public, anon;
grant execute on function public.process_weekly_food(uuid, uuid, integer, integer, boolean, text, uuid[]) to authenticated;
