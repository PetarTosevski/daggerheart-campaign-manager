-- Task 012: character food system.
--
-- Food is a single authoritative, campaign-scoped store held canonically in
-- PORTIONS. One ration = portions_per_ration (default 7). Batches record
-- acquisitions (fresh/preserved); an append-only transaction log audits every
-- authoritative quantity change; a weekly-process audit table records each
-- committed weekly run. Weekly processing is atomic and idempotent via the
-- shared operations foundation. Ration/portion display and shortage are derived.
--
-- Out of scope (Task 013+): inventory items, ownership/locations/containers,
-- transfers.

-- ---------------------------------------------------------------------------
-- food_settings (one row per campaign)
-- ---------------------------------------------------------------------------

create table public.food_settings (
  campaign_id uuid primary key references public.campaigns (id) on delete cascade,
  portions_per_ration integer not null default 7,
  portions_per_active_character_per_week integer not null default 7,
  default_spoilage_policy text not null default 'spoil_fresh',
  updated_at timestamptz not null default now(),
  constraint food_settings_ppr_positive check (portions_per_ration > 0),
  constraint food_settings_ppc_positive
    check (portions_per_active_character_per_week > 0),
  constraint food_settings_policy_valid
    check (default_spoilage_policy in ('spoil_fresh', 'retain'))
);

create trigger food_settings_set_updated_at
  before update on public.food_settings
  for each row execute function public.set_updated_at();

-- Seed defaults for every new campaign, and backfill existing campaigns.
create or replace function public.create_initial_food_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.food_settings (campaign_id) values (new.id)
  on conflict (campaign_id) do nothing;
  return new;
end;
$$;

create trigger campaigns_create_initial_food_settings
  after insert on public.campaigns
  for each row execute function public.create_initial_food_settings();

insert into public.food_settings (campaign_id)
select id from public.campaigns
on conflict (campaign_id) do nothing;

-- ---------------------------------------------------------------------------
-- food_batches
-- ---------------------------------------------------------------------------

create table public.food_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  label text not null,
  food_type text not null,
  acquired_week integer not null,
  acquired_cycle text,
  acquired_cycle_day smallint,
  initial_portions integer not null,
  remaining_portions integer not null,
  source_note text,
  status text not null default 'active',
  -- clock_timestamp() (not now()) gives a distinct creation instant per row even
  -- within one transaction, so FIFO ordering is deterministic by true insert order.
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint food_batches_label_valid
    check (char_length(btrim(label)) between 1 and 100),
  constraint food_batches_type_valid check (food_type in ('fresh', 'preserved')),
  constraint food_batches_status_valid
    check (status in ('active', 'depleted', 'spoiled')),
  constraint food_batches_week_valid check (acquired_week >= 1),
  constraint food_batches_cycle_valid
    check (acquired_cycle is null or acquired_cycle in ('DAY', 'NIGHT')),
  constraint food_batches_cycle_day_valid
    check (acquired_cycle_day is null or acquired_cycle_day between 1 and 7),
  constraint food_batches_initial_positive check (initial_portions > 0),
  constraint food_batches_remaining_valid
    check (remaining_portions between 0 and initial_portions),
  constraint food_batches_source_note_valid
    check (source_note is null or char_length(btrim(source_note)) between 1 and 300),
  constraint food_batches_campaign_id_id_unique unique (campaign_id, id)
);

create index food_batches_campaign_status_idx
  on public.food_batches (campaign_id, status);
-- Deterministic FIFO: oldest acquisition week first, then creation, then id.
create index food_batches_fifo_idx
  on public.food_batches (campaign_id, acquired_week, created_at, id);

create trigger food_batches_set_updated_at
  before update on public.food_batches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- food_transactions (append-only audit)
-- ---------------------------------------------------------------------------

create table public.food_transactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  batch_id uuid,
  character_id uuid,
  operation_id uuid,
  transaction_type text not null,
  portions_delta integer not null,
  before_portions integer not null,
  after_portions integer not null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  constraint food_transactions_type_valid
    check (transaction_type in (
      'acquire', 'consume', 'spoil', 'correction', 'override_adjust'
    )),
  constraint food_transactions_after_valid check (after_portions >= 0),
  constraint food_transactions_before_valid check (before_portions >= 0),
  constraint food_transactions_delta_consistent
    check (after_portions = before_portions + portions_delta),
  constraint food_transactions_reason_valid
    check (reason is null or char_length(btrim(reason)) between 1 and 300),
  constraint food_transactions_batch_same_campaign_fkey
    foreign key (campaign_id, batch_id)
    references public.food_batches (campaign_id, id) on delete restrict,
  constraint food_transactions_character_same_campaign_fkey
    foreign key (campaign_id, character_id)
    references public.characters (campaign_id, id) on delete set null (character_id),
  constraint food_transactions_operation_same_campaign_fkey
    foreign key (campaign_id, operation_id)
    references public.operations (campaign_id, id) on delete restrict
);

create index food_transactions_campaign_created_idx
  on public.food_transactions (campaign_id, created_at desc, id desc);
create index food_transactions_batch_idx on public.food_transactions (batch_id);
create index food_transactions_operation_idx on public.food_transactions (operation_id);

-- ---------------------------------------------------------------------------
-- food_week_processes (weekly-process audit)
-- ---------------------------------------------------------------------------

create table public.food_week_processes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  operation_id uuid not null,
  processed_week integer not null,
  roster_snapshot jsonb not null,
  active_character_count integer not null,
  default_required_portions integer not null,
  applied_required_portions integer not null,
  spoiled_portions integer not null,
  consumed_portions integer not null,
  shortage_portions integer not null,
  used_override boolean not null default false,
  override_reason text,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  constraint food_week_processes_week_valid check (processed_week >= 1),
  constraint food_week_processes_counts_valid check (
    active_character_count >= 0
    and default_required_portions >= 0
    and applied_required_portions >= 0
    and spoiled_portions >= 0
    and consumed_portions >= 0
    and shortage_portions >= 0
  ),
  constraint food_week_processes_roster_array
    check (jsonb_typeof(roster_snapshot) = 'array'),
  constraint food_week_processes_override_reason_valid
    check (
      (used_override and char_length(btrim(coalesce(override_reason, ''))) between 1 and 300)
      or (not used_override and override_reason is null)
    ),
  constraint food_week_processes_operation_unique unique (operation_id),
  constraint food_week_processes_operation_same_campaign_fkey
    foreign key (campaign_id, operation_id)
    references public.operations (campaign_id, id) on delete restrict
);

-- One standard (non-override) process per campaign week; overrides are a
-- separate, deliberate workflow and are not blocked by this.
create unique index food_week_processes_standard_week_unique
  on public.food_week_processes (campaign_id, processed_week)
  where not used_override;
create index food_week_processes_campaign_idx
  on public.food_week_processes (campaign_id, processed_week);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.food_settings enable row level security;
alter table public.food_batches enable row level security;
alter table public.food_transactions enable row level security;
alter table public.food_week_processes enable row level security;

create policy food_settings_select_own on public.food_settings
  for select using (public.owns_campaign(campaign_id));
create policy food_batches_select_own on public.food_batches
  for select using (public.owns_campaign(campaign_id));
create policy food_transactions_select_own on public.food_transactions
  for select using (public.owns_campaign(campaign_id));
create policy food_week_processes_select_own on public.food_week_processes
  for select using (public.owns_campaign(campaign_id));

-- Reads are RLS-scoped; all authoritative writes go through the functions below.
grant select on public.food_settings to authenticated;
grant select on public.food_batches to authenticated;
grant select on public.food_transactions to authenticated;
grant select on public.food_week_processes to authenticated;

-- ---------------------------------------------------------------------------
-- acquire_food_batch
-- ---------------------------------------------------------------------------

create function public.acquire_food_batch(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_label text,
  p_food_type text,
  p_initial_portions integer,
  p_source_note text
)
returns table (
  batch_id uuid,
  returned_label text,
  returned_food_type text,
  returned_acquired_week integer,
  returned_initial_portions integer,
  returned_remaining_portions integer,
  returned_status text,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_label text := btrim(p_label);
  v_type text := lower(btrim(p_food_type));
  v_note text := nullif(btrim(p_source_note), '');
  v_week integer;
  v_cycle text;
  v_cycle_day smallint;
  v_operation_id uuid;
  v_applied boolean;
  v_batch public.food_batches%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Campaign and idempotency key are required.';
  end if;
  if v_label is null or char_length(v_label) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Food label must contain between 1 and 100 characters.';
  end if;
  if v_type is null or v_type not in ('fresh', 'preserved') then
    raise exception using errcode = '22023', message = 'Food type must be fresh or preserved.';
  end if;
  if p_initial_portions is null or p_initial_portions <= 0 then
    raise exception using errcode = '22023', message = 'Portions must be a positive integer.';
  end if;

  select state.current_week, state.current_cycle, state.current_cycle_day
  into v_week, v_cycle, v_cycle_day
  from public.campaign_state as state
  join public.campaigns as campaign on campaign.id = state.campaign_id
  where state.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of state;

  if not found then
    raise exception using errcode = '42501', message = 'Campaign not found or access denied.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'food_acquire',
    'Acquire food batch',
    jsonb_build_object('label', v_label, 'food_type', v_type, 'initial_portions', p_initial_portions)
  ) as recorded;

  if not v_applied then
    select b.* into v_batch
    from public.food_batches as b
    join public.food_transactions as t on t.batch_id = b.id
    where t.operation_id = v_operation_id and t.transaction_type = 'acquire';
    return query select v_batch.id, v_batch.label, v_batch.food_type, v_batch.acquired_week,
      v_batch.initial_portions, v_batch.remaining_portions, v_batch.status, false;
    return;
  end if;

  insert into public.food_batches (
    campaign_id, label, food_type, acquired_week, acquired_cycle, acquired_cycle_day,
    initial_portions, remaining_portions, source_note, status
  )
  values (
    p_campaign_id, v_label, v_type, v_week, v_cycle, v_cycle_day,
    p_initial_portions, p_initial_portions, v_note, 'active'
  )
  returning * into v_batch;

  insert into public.food_transactions (
    campaign_id, batch_id, operation_id, transaction_type,
    portions_delta, before_portions, after_portions, created_by
  )
  values (
    p_campaign_id, v_batch.id, v_operation_id, 'acquire',
    p_initial_portions, 0, p_initial_portions, v_user_id
  );

  return query select v_batch.id, v_batch.label, v_batch.food_type, v_batch.acquired_week,
    v_batch.initial_portions, v_batch.remaining_portions, v_batch.status, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- process_weekly_food (atomic, idempotent weekly commit)
-- ---------------------------------------------------------------------------

create function public.process_weekly_food(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_target_week integer default null,
  p_override_required_portions integer default null,
  p_skip_spoilage boolean default false,
  p_reason text default null
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
  v_spoiled integer := 0;
  v_consumed integer := 0;
  v_shortage integer;
  v_available integer;
  v_needed integer;
  v_take integer;
  v_operation_id uuid;
  v_applied boolean;
  v_batch record;
  v_process public.food_week_processes%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'Campaign and idempotency key are required.';
  end if;

  v_used_override := (p_override_required_portions is not null) or v_skip_spoilage;
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

  -- Idempotency first: a genuine retry (same key) returns the original result
  -- without re-processing or tripping the duplicate-week guard below.
  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'food_weekly_process',
    'Process weekly food',
    jsonb_build_object('target_week', v_week, 'override_required', p_override_required_portions,
                       'skip_spoilage', v_skip_spoilage)
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

  -- 3. Available after spoilage.
  select coalesce(sum(remaining_portions), 0) into v_available
  from public.food_batches
  where campaign_id = p_campaign_id and status = 'active' and remaining_portions > 0;

  -- 4. Consume oldest eligible first (FIFO).
  v_needed := v_applied_required;
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

  -- 5. Shortage.
  v_shortage := greatest(0, v_applied_required - v_available);

  -- 6. Persist the process audit.
  insert into public.food_week_processes (
    campaign_id, operation_id, processed_week, roster_snapshot, active_character_count,
    default_required_portions, applied_required_portions, spoiled_portions,
    consumed_portions, shortage_portions, used_override, override_reason, created_by
  )
  values (
    p_campaign_id, v_operation_id, v_week, v_roster, v_count,
    v_default_required, v_applied_required, v_spoiled,
    v_consumed, v_shortage, v_used_override,
    case when v_used_override then v_reason else null end, v_user_id
  )
  returning * into v_process;

  return query select v_process.id, v_process.operation_id, v_process.processed_week,
    v_process.active_character_count, v_process.default_required_portions,
    v_process.applied_required_portions, v_process.spoiled_portions,
    v_process.consumed_portions, v_process.shortage_portions, v_process.used_override, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- correct_food_batch (audited compensating correction)
-- ---------------------------------------------------------------------------

create function public.correct_food_batch(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_batch_id uuid,
  p_new_remaining_portions integer,
  p_reason text
)
returns table (
  batch_id uuid,
  returned_remaining_portions integer,
  returned_status text,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_batch public.food_batches%rowtype;
  v_delta integer;
  v_new_status text;
  v_operation_id uuid;
  v_applied boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_batch_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and batch are required.';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'A correction requires a reason.';
  end if;

  select b.* into v_batch
  from public.food_batches as b
  join public.campaigns as campaign on campaign.id = b.campaign_id
  where b.id = p_batch_id and b.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of b;

  if not found then
    raise exception using errcode = '42501', message = 'Food batch not found or access denied.';
  end if;

  if p_new_remaining_portions is null
     or p_new_remaining_portions < 0
     or p_new_remaining_portions > v_batch.initial_portions then
    raise exception using errcode = '22023',
      message = 'Corrected remaining portions must be between 0 and the batch total.';
  end if;

  v_delta := p_new_remaining_portions - v_batch.remaining_portions;
  if v_delta = 0 then
    raise exception using errcode = '22023', message = 'The correction does not change the batch.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'food_correction', 'Correct food batch',
    jsonb_build_object('batch_id', p_batch_id, 'new_remaining', p_new_remaining_portions)
  ) as recorded;

  if not v_applied then
    select * into v_batch from public.food_batches where id = p_batch_id;
    return query select v_batch.id, v_batch.remaining_portions, v_batch.status, false;
    return;
  end if;

  v_new_status := case
    when p_new_remaining_portions = 0 then 'depleted'
    else 'active'
  end;

  insert into public.food_transactions (
    campaign_id, batch_id, operation_id, transaction_type,
    portions_delta, before_portions, after_portions, reason, created_by
  )
  values (
    p_campaign_id, p_batch_id, v_operation_id, 'correction',
    v_delta, v_batch.remaining_portions, p_new_remaining_portions, v_reason, v_user_id
  );

  update public.food_batches
  set remaining_portions = p_new_remaining_portions, status = v_new_status
  where id = p_batch_id
  returning * into v_batch;

  return query select v_batch.id, v_batch.remaining_portions, v_batch.status, true;
end;
$$;

revoke all on function public.acquire_food_batch(uuid, uuid, text, text, integer, text) from public, anon;
grant execute on function public.acquire_food_batch(uuid, uuid, text, text, integer, text) to authenticated;
revoke all on function public.process_weekly_food(uuid, uuid, integer, integer, boolean, text) from public, anon;
grant execute on function public.process_weekly_food(uuid, uuid, integer, integer, boolean, text) to authenticated;
revoke all on function public.correct_food_batch(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.correct_food_batch(uuid, uuid, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reserved food sheet keys are domain projections and cannot be written.
-- ---------------------------------------------------------------------------

create or replace function public.save_character_sheet_value(
  p_character_id uuid,
  p_template_field_id uuid,
  p_value text,
  p_expected_updated_at timestamptz
)
returns table (
  value_id uuid,
  returned_value text,
  returned_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign_id uuid;
  v_pinned_version uuid;
  v_field public.sheet_template_fields%rowtype;
  v_value text := p_value;
  v_readonly boolean;
  v_existing public.character_sheet_values%rowtype;
  v_num numeric;
  v_min numeric;
  v_max numeric;
  v_result public.character_sheet_values%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select character.campaign_id, character.sheet_template_version_id
  into v_campaign_id, v_pinned_version
  from public.characters as character
  join public.campaigns as campaign on campaign.id = character.campaign_id
  where character.id = p_character_id and campaign.owner_id = v_user_id
  for update of character;

  if not found then
    raise exception using errcode = '42501', message = 'Character not found or access denied.';
  end if;
  if v_pinned_version is null then
    raise exception using errcode = '22023', message = 'Character has no pinned template version.';
  end if;

  select field.* into v_field
  from public.sheet_template_fields as field
  where field.id = p_template_field_id and field.campaign_id = v_campaign_id;

  if not found then
    raise exception using errcode = '22023', message = 'Field not found in this campaign.';
  end if;
  if v_field.template_version_id <> v_pinned_version then
    raise exception using errcode = '22023', message = 'Field does not belong to the character''s pinned version.';
  end if;
  if not v_field.is_active then
    raise exception using errcode = '22023', message = 'Field is not active.';
  end if;

  -- Reserved food keys are read-only domain projections (Task 012).
  if v_field.field_key in ('food_rations', 'food_portions') then
    raise exception using errcode = '22023',
      message = 'Reserved food fields are read-only and cannot be edited.';
  end if;

  v_readonly := coalesce((v_field.configuration->>'readOnly')::boolean, false);
  if v_field.field_type = 'computed' or v_readonly then
    raise exception using errcode = '22023', message = 'Computed and read-only fields cannot be edited.';
  end if;

  if v_value is not null and btrim(v_value) = '' then
    v_value := null;
  end if;

  if v_value is not null then
    if v_field.field_type in ('number', 'counter') then
      begin
        v_num := v_value::numeric;
      exception when others then
        raise exception using errcode = '22023', message = 'Value must be a number.';
      end;
      v_value := v_num::text;
      v_min := (v_field.configuration->>'min')::numeric;
      v_max := (v_field.configuration->>'max')::numeric;
      if v_min is not null and v_num < v_min then
        raise exception using errcode = '22023', message = 'Value is below the allowed minimum.';
      end if;
      if v_max is not null and v_num > v_max then
        raise exception using errcode = '22023', message = 'Value is above the allowed maximum.';
      end if;
    elsif v_field.field_type = 'checkbox' then
      if v_value not in ('true', 'false') then
        raise exception using errcode = '22023', message = 'Checkbox value must be true or false.';
      end if;
    elsif v_field.field_type in ('select', 'radio') then
      if not exists (
        select 1 from jsonb_array_elements_text(coalesce(v_field.configuration->'options', '[]'::jsonb)) as opt
        where opt = v_value
      ) then
        raise exception using errcode = '22023', message = 'Value is not an allowed option.';
      end if;
    else
      if char_length(v_value) > 10000 then
        raise exception using errcode = '22023', message = 'Value is too long.';
      end if;
    end if;
  end if;

  select existing.* into v_existing
  from public.character_sheet_values as existing
  where existing.character_id = p_character_id and existing.template_field_id = p_template_field_id
  for update;

  if found then
    if p_expected_updated_at is null or v_existing.updated_at <> p_expected_updated_at then
      raise exception using errcode = '40001', message = 'The value changed since you last loaded it.';
    end if;
    update public.character_sheet_values
    set value = v_value, value_type = v_field.field_type, field_key = v_field.field_key
    where id = v_existing.id
    returning * into v_result;
  else
    if p_expected_updated_at is not null then
      raise exception using errcode = '40001', message = 'The value changed since you last loaded it.';
    end if;
    insert into public.character_sheet_values (
      campaign_id, character_id, template_field_id, field_key, value, value_type
    )
    values (
      v_campaign_id, p_character_id, p_template_field_id, v_field.field_key, v_value, v_field.field_type
    )
    returning * into v_result;
  end if;

  return query select v_result.id, v_result.value, v_result.updated_at;
end;
$$;
