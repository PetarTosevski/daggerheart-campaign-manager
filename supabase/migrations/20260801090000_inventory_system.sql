-- Task 013: character and campaign inventory system.
--
-- Inventory is a campaign-scoped, authoritative domain built on four tables:
--   item_definitions   reusable item templates (name, category, stack rules,
--                      unit weight).
--   inventory_containers  owned or shared, nestable holders (a character's
--                      backpack, a shared campaign store). Cycles are impossible.
--   inventory_entries  concrete stacks: a quantity of one item definition, held
--                      in a container (stored) or worn by a character (equipped).
--   inventory_transactions  append-only audit of every authoritative change.
--
-- Every write goes through an owner-authorized, idempotent SECURITY DEFINER
-- function that routes through the shared operations foundation
-- (public.record_operation) and appends an audit row. Reads are RLS-scoped.
-- Derived character-sheet fields (inventory_summary, equipped_items,
-- carried_weight) are read-only projections and cannot be written.
--
-- Out of scope (Task 015+): item media assets (item_definitions.asset_id is a
-- reserved nullable column with no foreign key yet).

-- ---------------------------------------------------------------------------
-- item_definitions
-- ---------------------------------------------------------------------------

create table public.item_definitions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  description text,
  category text not null default 'misc',
  stackable boolean not null default false,
  default_stack_limit integer,
  unit_weight numeric(10, 2),
  asset_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint item_definitions_name_valid
    check (char_length(btrim(name)) between 1 and 100),
  constraint item_definitions_description_valid
    check (description is null or char_length(btrim(description)) between 1 and 500),
  constraint item_definitions_category_valid
    check (category in ('weapon', 'armor', 'consumable', 'tool', 'treasure', 'misc')),
  -- A stack limit only makes sense for stackable items and must be positive.
  constraint item_definitions_stack_limit_valid
    check (
      (stackable and (default_stack_limit is null or default_stack_limit > 0))
      or (not stackable and default_stack_limit is null)
    ),
  constraint item_definitions_unit_weight_valid
    check (unit_weight is null or unit_weight >= 0),
  constraint item_definitions_campaign_id_id_unique unique (campaign_id, id)
);

create index item_definitions_campaign_active_idx
  on public.item_definitions (campaign_id, is_active);
create index item_definitions_campaign_category_idx
  on public.item_definitions (campaign_id, category);
-- Case-insensitive uniqueness of active item names within a campaign.
create unique index item_definitions_campaign_name_unique
  on public.item_definitions (campaign_id, lower(btrim(name)))
  where is_active;

create trigger item_definitions_set_updated_at
  before update on public.item_definitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_containers
-- ---------------------------------------------------------------------------

create table public.inventory_containers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  character_id uuid,
  parent_container_id uuid,
  name text not null,
  container_type text not null default 'storage',
  capacity_value numeric(10, 2),
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_containers_name_valid
    check (char_length(btrim(name)) between 1 and 100),
  constraint inventory_containers_type_valid
    check (container_type in ('backpack', 'equipment', 'storage', 'shared', 'other')),
  constraint inventory_containers_capacity_valid
    check (capacity_value is null or capacity_value >= 0),
  -- A container can never be its own direct parent (deeper cycles are blocked
  -- by a trigger and by the move function).
  constraint inventory_containers_not_self_parent
    check (parent_container_id is null or parent_container_id <> id),
  constraint inventory_containers_campaign_id_id_unique unique (campaign_id, id),
  constraint inventory_containers_character_same_campaign_fkey
    foreign key (campaign_id, character_id)
    references public.characters (campaign_id, id) on delete cascade,
  constraint inventory_containers_parent_same_campaign_fkey
    foreign key (campaign_id, parent_container_id)
    references public.inventory_containers (campaign_id, id) on delete cascade
);

create index inventory_containers_campaign_character_idx
  on public.inventory_containers (campaign_id, character_id);
create index inventory_containers_parent_idx
  on public.inventory_containers (parent_container_id);

create trigger inventory_containers_set_updated_at
  before update on public.inventory_containers
  for each row execute function public.set_updated_at();

-- Defense-in-depth cycle guard: reject any insert/update whose parent chain
-- reaches back to the row itself. All writes also go through move/create
-- functions that check this, but the trigger makes cycles impossible by any path.
create or replace function public.inventory_containers_prevent_cycle()
returns trigger
language plpgsql
as $$
declare
  v_current uuid := new.parent_container_id;
  v_guard integer := 0;
begin
  while v_current is not null loop
    if v_current = new.id then
      raise exception using errcode = '22023',
        message = 'A container cannot contain itself.';
    end if;
    select parent_container_id into v_current
    from public.inventory_containers
    where id = v_current;
    v_guard := v_guard + 1;
    if v_guard > 1000 then
      raise exception using errcode = '22023',
        message = 'Container nesting is too deep or cyclic.';
    end if;
  end loop;
  return new;
end;
$$;

create trigger inventory_containers_prevent_cycle
  before insert or update of parent_container_id on public.inventory_containers
  for each row execute function public.inventory_containers_prevent_cycle();

-- ---------------------------------------------------------------------------
-- inventory_entries
-- ---------------------------------------------------------------------------

create table public.inventory_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  character_id uuid,
  container_id uuid,
  item_definition_id uuid not null,
  quantity integer not null,
  state text not null default 'stored',
  equipped_slot text,
  custom_name text,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint inventory_entries_quantity_positive check (quantity > 0),
  constraint inventory_entries_state_valid check (state in ('stored', 'equipped')),
  -- A stored entry lives in a container with no slot; an equipped entry is worn
  -- by a character in a named slot, is not in a container, and is a single unit.
  constraint inventory_entries_placement_valid check (
    (state = 'stored'
      and container_id is not null
      and equipped_slot is null)
    or
    (state = 'equipped'
      and character_id is not null
      and container_id is null
      and equipped_slot is not null
      and quantity = 1)
  ),
  constraint inventory_entries_slot_valid
    check (equipped_slot is null or char_length(btrim(equipped_slot)) between 1 and 40),
  constraint inventory_entries_custom_name_valid
    check (custom_name is null or char_length(btrim(custom_name)) between 1 and 100),
  constraint inventory_entries_notes_valid
    check (notes is null or char_length(btrim(notes)) between 1 and 500),
  constraint inventory_entries_campaign_id_id_unique unique (campaign_id, id),
  constraint inventory_entries_item_same_campaign_fkey
    foreign key (campaign_id, item_definition_id)
    references public.item_definitions (campaign_id, id) on delete restrict,
  constraint inventory_entries_character_same_campaign_fkey
    foreign key (campaign_id, character_id)
    references public.characters (campaign_id, id) on delete cascade,
  constraint inventory_entries_container_same_campaign_fkey
    foreign key (campaign_id, container_id)
    references public.inventory_containers (campaign_id, id) on delete cascade
);

create index inventory_entries_campaign_character_idx
  on public.inventory_entries (campaign_id, character_id);
create index inventory_entries_container_idx
  on public.inventory_entries (container_id);
create index inventory_entries_item_idx
  on public.inventory_entries (item_definition_id);
-- At most one equipped item per character per slot.
create unique index inventory_entries_equipped_slot_unique
  on public.inventory_entries (campaign_id, character_id, equipped_slot)
  where state = 'equipped';

create trigger inventory_entries_set_updated_at
  before update on public.inventory_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_transactions (append-only audit)
-- ---------------------------------------------------------------------------

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  operation_id uuid,
  entry_id uuid,
  item_definition_id uuid,
  transaction_type text not null,
  quantity_delta integer not null,
  source_character_id uuid,
  target_character_id uuid,
  source_container_id uuid,
  target_container_id uuid,
  reason text,
  -- clock_timestamp() gives a distinct instant per row so multi-row operations
  -- (transfers, splits) keep a deterministic audit order within one transaction.
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users (id),
  constraint inventory_transactions_type_valid
    check (transaction_type in (
      'add', 'remove', 'move', 'transfer', 'equip', 'unequip',
      'consume', 'split', 'merge', 'correction'
    )),
  constraint inventory_transactions_reason_valid
    check (reason is null or char_length(btrim(reason)) between 1 and 300),
  constraint inventory_transactions_entry_same_campaign_fkey
    foreign key (campaign_id, entry_id)
    references public.inventory_entries (campaign_id, id) on delete set null (entry_id),
  constraint inventory_transactions_item_same_campaign_fkey
    foreign key (campaign_id, item_definition_id)
    references public.item_definitions (campaign_id, id) on delete set null (item_definition_id),
  constraint inventory_transactions_operation_same_campaign_fkey
    foreign key (campaign_id, operation_id)
    references public.operations (campaign_id, id) on delete restrict
);

create index inventory_transactions_campaign_created_idx
  on public.inventory_transactions (campaign_id, created_at desc, id desc);
create index inventory_transactions_entry_idx
  on public.inventory_transactions (entry_id);
create index inventory_transactions_operation_idx
  on public.inventory_transactions (operation_id);

-- ---------------------------------------------------------------------------
-- Per-campaign shared store and per-character default backpack (seed + backfill)
-- ---------------------------------------------------------------------------

create or replace function public.create_shared_inventory_container()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_containers (campaign_id, character_id, name, container_type, is_default)
  values (new.id, null, 'Shared Stores', 'shared', true);
  return new;
end;
$$;

create trigger campaigns_create_shared_inventory_container
  after insert on public.campaigns
  for each row execute function public.create_shared_inventory_container();

create or replace function public.create_character_default_container()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.inventory_containers (campaign_id, character_id, name, container_type, is_default)
  values (new.campaign_id, new.id, 'Backpack', 'backpack', true);
  return new;
end;
$$;

create trigger characters_create_default_container
  after insert on public.characters
  for each row execute function public.create_character_default_container();

-- Backfill existing campaigns and characters that predate this migration.
insert into public.inventory_containers (campaign_id, character_id, name, container_type, is_default)
select c.id, null, 'Shared Stores', 'shared', true
from public.campaigns as c
where not exists (
  select 1 from public.inventory_containers as ic
  where ic.campaign_id = c.id and ic.character_id is null and ic.is_default
);

insert into public.inventory_containers (campaign_id, character_id, name, container_type, is_default)
select ch.campaign_id, ch.id, 'Backpack', 'backpack', true
from public.characters as ch
where not exists (
  select 1 from public.inventory_containers as ic
  where ic.campaign_id = ch.campaign_id and ic.character_id = ch.id and ic.is_default
);

-- ---------------------------------------------------------------------------
-- Row-Level Security (reads only; writes go through functions below)
-- ---------------------------------------------------------------------------

alter table public.item_definitions enable row level security;
alter table public.inventory_containers enable row level security;
alter table public.inventory_entries enable row level security;
alter table public.inventory_transactions enable row level security;

create policy item_definitions_select_own on public.item_definitions
  for select using (public.owns_campaign(campaign_id));
create policy inventory_containers_select_own on public.inventory_containers
  for select using (public.owns_campaign(campaign_id));
create policy inventory_entries_select_own on public.inventory_entries
  for select using (public.owns_campaign(campaign_id));
create policy inventory_transactions_select_own on public.inventory_transactions
  for select using (public.owns_campaign(campaign_id));

grant select on public.item_definitions to authenticated;
grant select on public.inventory_containers to authenticated;
grant select on public.inventory_entries to authenticated;
grant select on public.inventory_transactions to authenticated;

-- ===========================================================================
-- Mutation functions. Every function: authenticates, validates, authorizes by
-- locking the owned campaign/row, routes through record_operation for
-- idempotency, applies the change, appends an audit row, and returns a trailing
-- was_applied flag. Create/add functions take a client-generated row id so a
-- genuine retry re-reads the same row. All raise '42501' for auth/authorization
-- and '22023' for invalid arguments or business-rule violations.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- create_item_definition
-- ---------------------------------------------------------------------------

create function public.create_item_definition(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_item_definition_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_stackable boolean,
  p_default_stack_limit integer,
  p_unit_weight numeric
)
returns table (
  item_definition_id uuid,
  returned_name text,
  returned_category text,
  returned_stackable boolean,
  returned_is_active boolean,
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
  v_category text := lower(btrim(coalesce(p_category, 'misc')));
  v_stackable boolean := coalesce(p_stackable, false);
  v_stack_limit integer := p_default_stack_limit;
  v_operation_id uuid;
  v_applied boolean;
  v_row public.item_definitions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_item_definition_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and item id are required.';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Item name must contain between 1 and 100 characters.';
  end if;
  if v_category not in ('weapon', 'armor', 'consumable', 'tool', 'treasure', 'misc') then
    raise exception using errcode = '22023', message = 'Item category is not valid.';
  end if;
  if not v_stackable then
    v_stack_limit := null;
  elsif v_stack_limit is not null and v_stack_limit <= 0 then
    raise exception using errcode = '22023', message = 'Stack limit must be a positive integer.';
  end if;
  if p_unit_weight is not null and p_unit_weight < 0 then
    raise exception using errcode = '22023', message = 'Unit weight cannot be negative.';
  end if;

  perform 1 from public.campaigns as campaign
  where campaign.id = p_campaign_id and campaign.owner_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Campaign not found or access denied.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_item_create', 'Create item definition',
    jsonb_build_object('item_definition_id', p_item_definition_id, 'name', v_name)
  ) as recorded;

  if not v_applied then
    select * into v_row from public.item_definitions where id = p_item_definition_id;
    return query select v_row.id, v_row.name, v_row.category, v_row.stackable, v_row.is_active, false;
    return;
  end if;

  insert into public.item_definitions (
    id, campaign_id, name, description, category, stackable, default_stack_limit, unit_weight
  )
  values (
    p_item_definition_id, p_campaign_id, v_name, v_description, v_category,
    v_stackable, v_stack_limit, p_unit_weight
  )
  returning * into v_row;

  return query select v_row.id, v_row.name, v_row.category, v_row.stackable, v_row.is_active, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_item_definition (edit fields; is_active toggles archive)
-- ---------------------------------------------------------------------------

create function public.update_item_definition(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_item_definition_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_stackable boolean,
  p_default_stack_limit integer,
  p_unit_weight numeric,
  p_is_active boolean
)
returns table (
  item_definition_id uuid,
  returned_name text,
  returned_category text,
  returned_stackable boolean,
  returned_is_active boolean,
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
  v_category text := lower(btrim(coalesce(p_category, 'misc')));
  v_stackable boolean := coalesce(p_stackable, false);
  v_stack_limit integer := p_default_stack_limit;
  v_is_active boolean := coalesce(p_is_active, true);
  v_operation_id uuid;
  v_applied boolean;
  v_row public.item_definitions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_item_definition_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and item id are required.';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Item name must contain between 1 and 100 characters.';
  end if;
  if v_category not in ('weapon', 'armor', 'consumable', 'tool', 'treasure', 'misc') then
    raise exception using errcode = '22023', message = 'Item category is not valid.';
  end if;
  if not v_stackable then
    v_stack_limit := null;
  elsif v_stack_limit is not null and v_stack_limit <= 0 then
    raise exception using errcode = '22023', message = 'Stack limit must be a positive integer.';
  end if;
  if p_unit_weight is not null and p_unit_weight < 0 then
    raise exception using errcode = '22023', message = 'Unit weight cannot be negative.';
  end if;

  select d.* into v_row
  from public.item_definitions as d
  join public.campaigns as campaign on campaign.id = d.campaign_id
  where d.id = p_item_definition_id and d.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of d;
  if not found then
    raise exception using errcode = '42501', message = 'Item definition not found or access denied.';
  end if;

  -- Reducing a stack limit below quantities already held would strand stacks.
  if v_stackable and v_stack_limit is not null and exists (
    select 1 from public.inventory_entries
    where item_definition_id = p_item_definition_id and quantity > v_stack_limit
  ) then
    raise exception using errcode = '22023',
      message = 'Stack limit is below an existing stack; split those stacks first.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_item_update', 'Update item definition',
    jsonb_build_object('item_definition_id', p_item_definition_id, 'is_active', v_is_active)
  ) as recorded;

  if not v_applied then
    select * into v_row from public.item_definitions where id = p_item_definition_id;
    return query select v_row.id, v_row.name, v_row.category, v_row.stackable, v_row.is_active, false;
    return;
  end if;

  update public.item_definitions
  set name = v_name, description = v_description, category = v_category,
      stackable = v_stackable, default_stack_limit = v_stack_limit,
      unit_weight = p_unit_weight, is_active = v_is_active
  where id = p_item_definition_id
  returning * into v_row;

  return query select v_row.id, v_row.name, v_row.category, v_row.stackable, v_row.is_active, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_inventory_container
-- ---------------------------------------------------------------------------

create function public.create_inventory_container(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_container_id uuid,
  p_character_id uuid,
  p_parent_container_id uuid,
  p_name text,
  p_container_type text,
  p_capacity_value numeric
)
returns table (
  container_id uuid,
  returned_name text,
  returned_character_id uuid,
  returned_parent_container_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(p_name);
  v_type text := lower(btrim(coalesce(p_container_type, 'storage')));
  v_operation_id uuid;
  v_applied boolean;
  v_parent public.inventory_containers%rowtype;
  v_row public.inventory_containers%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_container_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and container id are required.';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Container name must contain between 1 and 100 characters.';
  end if;
  if v_type not in ('backpack', 'equipment', 'storage', 'shared', 'other') then
    raise exception using errcode = '22023', message = 'Container type is not valid.';
  end if;
  if p_capacity_value is not null and p_capacity_value < 0 then
    raise exception using errcode = '22023', message = 'Container capacity cannot be negative.';
  end if;

  perform 1 from public.campaigns as campaign
  where campaign.id = p_campaign_id and campaign.owner_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Campaign not found or access denied.';
  end if;

  if p_character_id is not null and not exists (
    select 1 from public.characters where id = p_character_id and campaign_id = p_campaign_id
  ) then
    raise exception using errcode = '22023', message = 'Owning character is not in this campaign.';
  end if;

  if p_parent_container_id is not null then
    select * into v_parent from public.inventory_containers
    where id = p_parent_container_id and campaign_id = p_campaign_id;
    if not found then
      raise exception using errcode = '22023', message = 'Parent container is not in this campaign.';
    end if;
    -- A nested container must share its parent's owner.
    if v_parent.character_id is distinct from p_character_id then
      raise exception using errcode = '22023', message = 'A nested container must share its parent owner.';
    end if;
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_container_create', 'Create inventory container',
    jsonb_build_object('container_id', p_container_id, 'name', v_name)
  ) as recorded;

  if not v_applied then
    select * into v_row from public.inventory_containers where id = p_container_id;
    return query select v_row.id, v_row.name, v_row.character_id, v_row.parent_container_id, false;
    return;
  end if;

  insert into public.inventory_containers (
    id, campaign_id, character_id, parent_container_id, name, container_type, capacity_value
  )
  values (
    p_container_id, p_campaign_id, p_character_id, p_parent_container_id, v_name, v_type, p_capacity_value
  )
  returning * into v_row;

  return query select v_row.id, v_row.name, v_row.character_id, v_row.parent_container_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- move_inventory_container (re-parent; cycle-safe)
-- ---------------------------------------------------------------------------

create function public.move_inventory_container(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_container_id uuid,
  p_new_parent_container_id uuid
)
returns table (
  container_id uuid,
  returned_name text,
  returned_character_id uuid,
  returned_parent_container_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation_id uuid;
  v_applied boolean;
  v_container public.inventory_containers%rowtype;
  v_parent public.inventory_containers%rowtype;
  v_cursor uuid;
  v_guard integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_container_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and container id are required.';
  end if;

  select c.* into v_container
  from public.inventory_containers as c
  join public.campaigns as campaign on campaign.id = c.campaign_id
  where c.id = p_container_id and c.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of c;
  if not found then
    raise exception using errcode = '42501', message = 'Container not found or access denied.';
  end if;

  if p_new_parent_container_id is not null then
    if p_new_parent_container_id = p_container_id then
      raise exception using errcode = '22023', message = 'A container cannot contain itself.';
    end if;
    select * into v_parent from public.inventory_containers
    where id = p_new_parent_container_id and campaign_id = p_campaign_id;
    if not found then
      raise exception using errcode = '22023', message = 'Parent container is not in this campaign.';
    end if;
    if v_parent.character_id is distinct from v_container.character_id then
      raise exception using errcode = '22023', message = 'A nested container must share its parent owner.';
    end if;
    -- Walk the prospective parent chain; reaching this container is a cycle.
    v_cursor := p_new_parent_container_id;
    while v_cursor is not null loop
      if v_cursor = p_container_id then
        raise exception using errcode = '22023', message = 'That move would create a container cycle.';
      end if;
      select parent_container_id into v_cursor from public.inventory_containers where id = v_cursor;
      v_guard := v_guard + 1;
      if v_guard > 1000 then
        raise exception using errcode = '22023', message = 'Container nesting is too deep or cyclic.';
      end if;
    end loop;
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_container_move', 'Move inventory container',
    jsonb_build_object('container_id', p_container_id, 'parent_container_id', p_new_parent_container_id)
  ) as recorded;

  if not v_applied then
    select * into v_container from public.inventory_containers where id = p_container_id;
    return query select v_container.id, v_container.name, v_container.character_id,
      v_container.parent_container_id, false;
    return;
  end if;

  update public.inventory_containers
  set parent_container_id = p_new_parent_container_id
  where id = p_container_id
  returning * into v_container;

  return query select v_container.id, v_container.name, v_container.character_id,
    v_container.parent_container_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_inventory_item (create a new stack in a container)
-- ---------------------------------------------------------------------------

create function public.add_inventory_item(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_entry_id uuid,
  p_item_definition_id uuid,
  p_container_id uuid,
  p_quantity integer,
  p_custom_name text,
  p_notes text
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_custom_name text := nullif(btrim(p_custom_name), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_operation_id uuid;
  v_applied boolean;
  v_item public.item_definitions%rowtype;
  v_container public.inventory_containers%rowtype;
  v_row public.inventory_entries%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_entry_id is null
     or p_item_definition_id is null or p_container_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, entry id, item, and container are required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'Quantity must be a positive integer.';
  end if;

  perform 1 from public.campaigns as campaign
  where campaign.id = p_campaign_id and campaign.owner_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Campaign not found or access denied.';
  end if;

  select * into v_item from public.item_definitions
  where id = p_item_definition_id and campaign_id = p_campaign_id;
  if not found then
    raise exception using errcode = '22023', message = 'Item definition is not in this campaign.';
  end if;
  if not v_item.is_active then
    raise exception using errcode = '22023', message = 'Item definition is archived.';
  end if;

  select * into v_container from public.inventory_containers
  where id = p_container_id and campaign_id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Container is not in this campaign.';
  end if;

  if not v_item.stackable and p_quantity <> 1 then
    raise exception using errcode = '22023', message = 'This item is not stackable; add one at a time.';
  end if;
  if v_item.stackable and v_item.default_stack_limit is not null
     and p_quantity > v_item.default_stack_limit then
    raise exception using errcode = '22023', message = 'Quantity exceeds this item''s stack limit.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_add', 'Add inventory item',
    jsonb_build_object('entry_id', p_entry_id, 'item_definition_id', p_item_definition_id,
                       'container_id', p_container_id, 'quantity', p_quantity)
  ) as recorded;

  if not v_applied then
    select * into v_row from public.inventory_entries where id = p_entry_id;
    return query select v_row.id, v_row.quantity, v_row.state, v_row.container_id, v_row.character_id, false;
    return;
  end if;

  insert into public.inventory_entries (
    id, campaign_id, character_id, container_id, item_definition_id,
    quantity, state, custom_name, notes
  )
  values (
    p_entry_id, p_campaign_id, v_container.character_id, p_container_id, p_item_definition_id,
    p_quantity, 'stored', v_custom_name, v_notes
  )
  returning * into v_row;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, target_character_id, target_container_id, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_entry_id, p_item_definition_id, 'add',
    p_quantity, v_container.character_id, p_container_id, v_user_id
  );

  return query select v_row.id, v_row.quantity, v_row.state, v_row.container_id, v_row.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- transfer_inventory_entry (move a whole stack; owner may change)
-- ---------------------------------------------------------------------------

create function public.transfer_inventory_entry(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_entry_id uuid,
  p_target_container_id uuid,
  p_reason text
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_operation_id uuid;
  v_applied boolean;
  v_entry public.inventory_entries%rowtype;
  v_target public.inventory_containers%rowtype;
  v_type text;
  v_source_character uuid;
  v_source_container uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_entry_id is null
     or p_target_container_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, entry, and target container are required.';
  end if;

  select e.* into v_entry
  from public.inventory_entries as e
  join public.campaigns as campaign on campaign.id = e.campaign_id
  where e.id = p_entry_id and e.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of e;
  if not found then
    raise exception using errcode = '42501', message = 'Inventory entry not found or access denied.';
  end if;
  if v_entry.state = 'equipped' then
    raise exception using errcode = '22023', message = 'Unequip this item before moving it.';
  end if;

  select * into v_target from public.inventory_containers
  where id = p_target_container_id and campaign_id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Target container is not in this campaign.';
  end if;
  if p_target_container_id = v_entry.container_id then
    raise exception using errcode = '22023', message = 'The item is already in that container.';
  end if;

  v_type := case when v_target.character_id is distinct from v_entry.character_id
                 then 'transfer' else 'move' end;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_' || v_type, 'Relocate inventory entry',
    jsonb_build_object('entry_id', p_entry_id, 'target_container_id', p_target_container_id)
  ) as recorded;

  if not v_applied then
    select * into v_entry from public.inventory_entries where id = p_entry_id;
    return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
      v_entry.character_id, false;
    return;
  end if;

  v_source_character := v_entry.character_id;
  v_source_container := v_entry.container_id;

  update public.inventory_entries
  set container_id = p_target_container_id, character_id = v_target.character_id
  where id = p_entry_id
  returning * into v_entry;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, source_character_id, target_character_id,
    source_container_id, target_container_id, reason, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_entry_id, v_entry.item_definition_id, v_type,
    0, v_source_character, v_target.character_id,
    v_source_container, p_target_container_id, v_reason, v_user_id
  );

  return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
    v_entry.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- split_inventory_entry (peel a quantity off a stack into a new entry)
-- ---------------------------------------------------------------------------

create function public.split_inventory_entry(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_new_entry_id uuid,
  p_entry_id uuid,
  p_quantity integer
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation_id uuid;
  v_applied boolean;
  v_entry public.inventory_entries%rowtype;
  v_item public.item_definitions%rowtype;
  v_new public.inventory_entries%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_new_entry_id is null or p_entry_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and entry ids are required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'Split quantity must be a positive integer.';
  end if;

  select e.* into v_entry
  from public.inventory_entries as e
  join public.campaigns as campaign on campaign.id = e.campaign_id
  where e.id = p_entry_id and e.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of e;
  if not found then
    raise exception using errcode = '42501', message = 'Inventory entry not found or access denied.';
  end if;
  if v_entry.state <> 'stored' then
    raise exception using errcode = '22023', message = 'Only stored stacks can be split.';
  end if;
  if p_quantity >= v_entry.quantity then
    raise exception using errcode = '22023', message = 'Split quantity must be less than the stack size.';
  end if;

  select * into v_item from public.item_definitions where id = v_entry.item_definition_id;
  if not v_item.stackable then
    raise exception using errcode = '22023', message = 'This item is not stackable.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_split', 'Split inventory stack',
    jsonb_build_object('entry_id', p_entry_id, 'new_entry_id', p_new_entry_id, 'quantity', p_quantity)
  ) as recorded;

  if not v_applied then
    select * into v_new from public.inventory_entries where id = p_new_entry_id;
    return query select v_new.id, v_new.quantity, v_new.state, v_new.container_id, v_new.character_id, false;
    return;
  end if;

  update public.inventory_entries
  set quantity = quantity - p_quantity
  where id = p_entry_id;

  insert into public.inventory_entries (
    id, campaign_id, character_id, container_id, item_definition_id,
    quantity, state, custom_name, notes
  )
  values (
    p_new_entry_id, p_campaign_id, v_entry.character_id, v_entry.container_id, v_entry.item_definition_id,
    p_quantity, 'stored', v_entry.custom_name, v_entry.notes
  )
  returning * into v_new;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, source_character_id, target_character_id,
    source_container_id, target_container_id, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_new_entry_id, v_entry.item_definition_id, 'split',
    p_quantity, v_entry.character_id, v_entry.character_id,
    v_entry.container_id, v_entry.container_id, v_user_id
  );

  return query select v_new.id, v_new.quantity, v_new.state, v_new.container_id, v_new.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_inventory_entries (combine two like stacks into the target)
-- ---------------------------------------------------------------------------

create function public.merge_inventory_entries(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_source_entry_id uuid,
  p_target_entry_id uuid
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation_id uuid;
  v_applied boolean;
  v_source public.inventory_entries%rowtype;
  v_target public.inventory_entries%rowtype;
  v_item public.item_definitions%rowtype;
  v_moved integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null
     or p_source_entry_id is null or p_target_entry_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and both entry ids are required.';
  end if;
  if p_source_entry_id = p_target_entry_id then
    raise exception using errcode = '22023', message = 'Choose two different stacks to merge.';
  end if;

  perform 1 from public.campaigns as campaign
  where campaign.id = p_campaign_id and campaign.owner_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Campaign not found or access denied.';
  end if;

  -- Lock both rows in a stable order to avoid deadlocks.
  select * into v_source from public.inventory_entries
  where id = least(p_source_entry_id, p_target_entry_id) and campaign_id = p_campaign_id for update;
  perform 1 from public.inventory_entries
  where id = greatest(p_source_entry_id, p_target_entry_id) and campaign_id = p_campaign_id for update;

  select * into v_source from public.inventory_entries
  where id = p_source_entry_id and campaign_id = p_campaign_id;
  if not found then
    raise exception using errcode = '22023', message = 'Source stack not found in this campaign.';
  end if;
  select * into v_target from public.inventory_entries
  where id = p_target_entry_id and campaign_id = p_campaign_id;
  if not found then
    raise exception using errcode = '22023', message = 'Target stack not found in this campaign.';
  end if;

  if v_source.item_definition_id <> v_target.item_definition_id then
    raise exception using errcode = '22023', message = 'Only stacks of the same item can be merged.';
  end if;
  if v_source.state <> 'stored' or v_target.state <> 'stored' then
    raise exception using errcode = '22023', message = 'Only stored stacks can be merged.';
  end if;
  if v_source.container_id is distinct from v_target.container_id then
    raise exception using errcode = '22023', message = 'Stacks must be in the same container to merge.';
  end if;

  select * into v_item from public.item_definitions where id = v_target.item_definition_id;
  if not v_item.stackable then
    raise exception using errcode = '22023', message = 'This item is not stackable.';
  end if;
  if v_item.default_stack_limit is not null
     and v_source.quantity + v_target.quantity > v_item.default_stack_limit then
    raise exception using errcode = '22023', message = 'Merged quantity would exceed the stack limit.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_merge', 'Merge inventory stacks',
    jsonb_build_object('source_entry_id', p_source_entry_id, 'target_entry_id', p_target_entry_id)
  ) as recorded;

  if not v_applied then
    select * into v_target from public.inventory_entries where id = p_target_entry_id;
    return query select v_target.id, v_target.quantity, v_target.state, v_target.container_id,
      v_target.character_id, false;
    return;
  end if;

  v_moved := v_source.quantity;

  update public.inventory_entries
  set quantity = quantity + v_moved
  where id = p_target_entry_id
  returning * into v_target;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, source_container_id, target_container_id, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_target_entry_id, v_target.item_definition_id, 'merge',
    v_moved, v_source.container_id, v_target.container_id, v_user_id
  );

  delete from public.inventory_entries where id = p_source_entry_id;

  return query select v_target.id, v_target.quantity, v_target.state, v_target.container_id,
    v_target.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- equip_inventory_entry (wear a single unit in a slot)
-- ---------------------------------------------------------------------------

create function public.equip_inventory_entry(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_entry_id uuid,
  p_equipped_slot text
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_slot text := lower(btrim(p_equipped_slot));
  v_operation_id uuid;
  v_applied boolean;
  v_entry public.inventory_entries%rowtype;
  v_source_container uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_entry_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and entry id are required.';
  end if;
  if v_slot is null or char_length(v_slot) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'Equip slot must contain between 1 and 40 characters.';
  end if;

  select e.* into v_entry
  from public.inventory_entries as e
  join public.campaigns as campaign on campaign.id = e.campaign_id
  where e.id = p_entry_id and e.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of e;
  if not found then
    raise exception using errcode = '42501', message = 'Inventory entry not found or access denied.';
  end if;
  if v_entry.state = 'equipped' then
    raise exception using errcode = '22023', message = 'This item is already equipped.';
  end if;
  if v_entry.character_id is null then
    raise exception using errcode = '22023', message = 'Only a character-owned item can be equipped.';
  end if;
  if v_entry.quantity <> 1 then
    raise exception using errcode = '22023', message = 'Split a single unit before equipping.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_equip', 'Equip inventory item',
    jsonb_build_object('entry_id', p_entry_id, 'equipped_slot', v_slot)
  ) as recorded;

  if not v_applied then
    select * into v_entry from public.inventory_entries where id = p_entry_id;
    return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
      v_entry.character_id, false;
    return;
  end if;

  v_source_container := v_entry.container_id;

  begin
    update public.inventory_entries
    set state = 'equipped', equipped_slot = v_slot, container_id = null
    where id = p_entry_id
    returning * into v_entry;
  exception when unique_violation then
    raise exception using errcode = '22023',
      message = 'That equip slot is already occupied. Unequip the current item first.';
  end;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, source_character_id, target_character_id, source_container_id, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_entry_id, v_entry.item_definition_id, 'equip',
    0, v_entry.character_id, v_entry.character_id, v_source_container, v_user_id
  );

  return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
    v_entry.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- unequip_inventory_entry (stow a worn item back into a container)
-- ---------------------------------------------------------------------------

create function public.unequip_inventory_entry(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_entry_id uuid,
  p_target_container_id uuid
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation_id uuid;
  v_applied boolean;
  v_entry public.inventory_entries%rowtype;
  v_target public.inventory_containers%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_entry_id is null
     or p_target_container_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, entry, and target container are required.';
  end if;

  select e.* into v_entry
  from public.inventory_entries as e
  join public.campaigns as campaign on campaign.id = e.campaign_id
  where e.id = p_entry_id and e.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of e;
  if not found then
    raise exception using errcode = '42501', message = 'Inventory entry not found or access denied.';
  end if;
  if v_entry.state <> 'equipped' then
    raise exception using errcode = '22023', message = 'This item is not equipped.';
  end if;

  select * into v_target from public.inventory_containers
  where id = p_target_container_id and campaign_id = p_campaign_id;
  if not found then
    raise exception using errcode = '22023', message = 'Target container is not in this campaign.';
  end if;
  -- Stow only into a container the wearer owns.
  if v_target.character_id is distinct from v_entry.character_id then
    raise exception using errcode = '22023', message = 'Stow the item into one of its owner''s containers.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_unequip', 'Unequip inventory item',
    jsonb_build_object('entry_id', p_entry_id, 'target_container_id', p_target_container_id)
  ) as recorded;

  if not v_applied then
    select * into v_entry from public.inventory_entries where id = p_entry_id;
    return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
      v_entry.character_id, false;
    return;
  end if;

  update public.inventory_entries
  set state = 'stored', equipped_slot = null, container_id = p_target_container_id
  where id = p_entry_id
  returning * into v_entry;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, source_character_id, target_character_id, target_container_id, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_entry_id, v_entry.item_definition_id, 'unequip',
    0, v_entry.character_id, v_entry.character_id, p_target_container_id, v_user_id
  );

  return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
    v_entry.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- consume_inventory_entry (decrement a stack; deletes it at zero)
-- ---------------------------------------------------------------------------

create function public.consume_inventory_entry(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_entry_id uuid,
  p_quantity integer,
  p_reason text
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_operation_id uuid;
  v_applied boolean;
  v_entry public.inventory_entries%rowtype;
  v_new_quantity integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_entry_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and entry id are required.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'Consume quantity must be a positive integer.';
  end if;

  select e.* into v_entry
  from public.inventory_entries as e
  join public.campaigns as campaign on campaign.id = e.campaign_id
  where e.id = p_entry_id and e.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of e;
  if not found then
    raise exception using errcode = '42501', message = 'Inventory entry not found or access denied.';
  end if;
  if p_quantity > v_entry.quantity then
    raise exception using errcode = '22023', message = 'Cannot consume more than the stack holds.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_consume', 'Consume inventory item',
    jsonb_build_object('entry_id', p_entry_id, 'quantity', p_quantity)
  ) as recorded;

  if not v_applied then
    select * into v_entry from public.inventory_entries where id = p_entry_id;
    return query select v_entry.id, coalesce(v_entry.quantity, 0), v_entry.state,
      v_entry.container_id, v_entry.character_id, false;
    return;
  end if;

  v_new_quantity := v_entry.quantity - p_quantity;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, source_character_id, source_container_id, reason, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_entry_id, v_entry.item_definition_id, 'consume',
    -p_quantity, v_entry.character_id, v_entry.container_id, v_reason, v_user_id
  );

  if v_new_quantity = 0 then
    delete from public.inventory_entries where id = p_entry_id;
    return query select null::uuid, 0, v_entry.state, v_entry.container_id, v_entry.character_id, true;
    return;
  end if;

  update public.inventory_entries
  set quantity = v_new_quantity
  where id = p_entry_id
  returning * into v_entry;

  return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
    v_entry.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- correct_inventory_entry (audited compensating correction)
-- ---------------------------------------------------------------------------

create function public.correct_inventory_entry(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_entry_id uuid,
  p_new_quantity integer,
  p_reason text
)
returns table (
  entry_id uuid,
  returned_quantity integer,
  returned_state text,
  returned_container_id uuid,
  returned_character_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_operation_id uuid;
  v_applied boolean;
  v_entry public.inventory_entries%rowtype;
  v_item public.item_definitions%rowtype;
  v_delta integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_campaign_id is null or p_idempotency_key is null or p_entry_id is null then
    raise exception using errcode = '22023', message = 'Campaign, key, and entry id are required.';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'A correction requires a reason.';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception using errcode = '22023', message = 'Corrected quantity cannot be negative.';
  end if;

  select e.* into v_entry
  from public.inventory_entries as e
  join public.campaigns as campaign on campaign.id = e.campaign_id
  where e.id = p_entry_id and e.campaign_id = p_campaign_id and campaign.owner_id = v_user_id
  for update of e;
  if not found then
    raise exception using errcode = '42501', message = 'Inventory entry not found or access denied.';
  end if;

  if v_entry.state = 'equipped' and p_new_quantity > 1 then
    raise exception using errcode = '22023', message = 'An equipped item is a single unit.';
  end if;

  v_delta := p_new_quantity - v_entry.quantity;
  if v_delta = 0 then
    raise exception using errcode = '22023', message = 'The correction does not change the stack.';
  end if;

  select * into v_item from public.item_definitions where id = v_entry.item_definition_id;
  if v_item.stackable and v_item.default_stack_limit is not null
     and p_new_quantity > v_item.default_stack_limit then
    raise exception using errcode = '22023', message = 'Corrected quantity exceeds the stack limit.';
  end if;
  if not v_item.stackable and p_new_quantity > 1 then
    raise exception using errcode = '22023', message = 'This item is not stackable.';
  end if;

  select recorded.operation_id, recorded.was_applied
  into v_operation_id, v_applied
  from public.record_operation(
    p_campaign_id, p_idempotency_key, 'inventory_correction', 'Correct inventory stack',
    jsonb_build_object('entry_id', p_entry_id, 'new_quantity', p_new_quantity)
  ) as recorded;

  if not v_applied then
    select * into v_entry from public.inventory_entries where id = p_entry_id;
    return query select v_entry.id, coalesce(v_entry.quantity, 0), v_entry.state,
      v_entry.container_id, v_entry.character_id, false;
    return;
  end if;

  insert into public.inventory_transactions (
    campaign_id, operation_id, entry_id, item_definition_id, transaction_type,
    quantity_delta, source_character_id, source_container_id, reason, created_by
  )
  values (
    p_campaign_id, v_operation_id, p_entry_id, v_entry.item_definition_id, 'correction',
    v_delta, v_entry.character_id, v_entry.container_id, v_reason, v_user_id
  );

  if p_new_quantity = 0 then
    delete from public.inventory_entries where id = p_entry_id;
    return query select null::uuid, 0, v_entry.state, v_entry.container_id, v_entry.character_id, true;
    return;
  end if;

  update public.inventory_entries
  set quantity = p_new_quantity
  where id = p_entry_id
  returning * into v_entry;

  return query select v_entry.id, v_entry.quantity, v_entry.state, v_entry.container_id,
    v_entry.character_id, true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants: reads via RLS, writes via these functions only.
-- ---------------------------------------------------------------------------

revoke all on function public.create_item_definition(uuid, uuid, uuid, text, text, text, boolean, integer, numeric) from public, anon;
grant execute on function public.create_item_definition(uuid, uuid, uuid, text, text, text, boolean, integer, numeric) to authenticated;
revoke all on function public.update_item_definition(uuid, uuid, uuid, text, text, text, boolean, integer, numeric, boolean) from public, anon;
grant execute on function public.update_item_definition(uuid, uuid, uuid, text, text, text, boolean, integer, numeric, boolean) to authenticated;
revoke all on function public.create_inventory_container(uuid, uuid, uuid, uuid, uuid, text, text, numeric) from public, anon;
grant execute on function public.create_inventory_container(uuid, uuid, uuid, uuid, uuid, text, text, numeric) to authenticated;
revoke all on function public.move_inventory_container(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.move_inventory_container(uuid, uuid, uuid, uuid) to authenticated;
revoke all on function public.add_inventory_item(uuid, uuid, uuid, uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.add_inventory_item(uuid, uuid, uuid, uuid, uuid, integer, text, text) to authenticated;
revoke all on function public.transfer_inventory_entry(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.transfer_inventory_entry(uuid, uuid, uuid, uuid, text) to authenticated;
revoke all on function public.split_inventory_entry(uuid, uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.split_inventory_entry(uuid, uuid, uuid, uuid, integer) to authenticated;
revoke all on function public.merge_inventory_entries(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_inventory_entries(uuid, uuid, uuid, uuid) to authenticated;
revoke all on function public.equip_inventory_entry(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.equip_inventory_entry(uuid, uuid, uuid, text) to authenticated;
revoke all on function public.unequip_inventory_entry(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.unequip_inventory_entry(uuid, uuid, uuid, uuid) to authenticated;
revoke all on function public.consume_inventory_entry(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.consume_inventory_entry(uuid, uuid, uuid, integer, text) to authenticated;
revoke all on function public.correct_inventory_entry(uuid, uuid, uuid, integer, text) from public, anon;
grant execute on function public.correct_inventory_entry(uuid, uuid, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reserved inventory sheet keys are domain projections and cannot be written.
-- Re-creates save_character_sheet_value to add the inventory reserved guard
-- alongside the existing food guard (Task 012).
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

  -- Reserved inventory keys are read-only domain projections (Task 013).
  if v_field.field_key in ('inventory_summary', 'equipped_items', 'carried_weight') then
    raise exception using errcode = '22023',
      message = 'Reserved inventory fields are read-only and cannot be edited.';
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
