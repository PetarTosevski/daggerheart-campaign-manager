-- Phase 1 schema: campaigns, campaign_state, fear_events, countdowns,
-- countdown_events, characters.
--
-- Canonical campaign time is stored as (current_week, current_cycle,
-- current_cycle_day). Named time phases (e.g. "Forenoon", "Dead of Night") are
-- derived by application logic and are never persisted as the current time.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint campaigns_name_not_blank check (char_length(btrim(name)) between 1 and 100),
  constraint campaigns_status_valid check (status in ('active', 'archived'))
);

create index campaigns_owner_id_idx on public.campaigns (owner_id);

create trigger campaigns_set_updated_at
  before update on public.campaigns
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- campaign_state (one cached current-state row per campaign)
-- ---------------------------------------------------------------------------

create table public.campaign_state (
  campaign_id uuid primary key references public.campaigns (id) on delete cascade,
  current_week integer not null default 1,
  current_cycle text not null default 'DAY',
  current_cycle_day smallint not null default 1,
  current_fear integer not null default 0,
  campaign_phase text,
  updated_at timestamptz not null default now(),
  constraint campaign_state_week_valid check (current_week >= 1),
  constraint campaign_state_cycle_valid check (current_cycle in ('DAY', 'NIGHT')),
  constraint campaign_state_cycle_day_valid check (current_cycle_day between 1 and 7),
  constraint campaign_state_fear_valid check (current_fear between 0 and 12)
);

create trigger campaign_state_set_updated_at
  before update on public.campaign_state
  for each row
  execute function public.set_updated_at();

-- Automatically create exactly one initial campaign_state row for each new
-- campaign: Week 1, Day cycle, cycle day 1, Fear 0.
create or replace function public.create_initial_campaign_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.campaign_state (campaign_id)
  values (new.id);
  return new;
end;
$$;

create trigger campaigns_create_initial_state
  after insert on public.campaigns
  for each row
  execute function public.create_initial_campaign_state();

-- ---------------------------------------------------------------------------
-- fear_events (audit history for every Fear change)
-- ---------------------------------------------------------------------------

create table public.fear_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  operation_id uuid,
  amount integer not null,
  reason text not null,
  event_type text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  constraint fear_events_amount_nonzero check (amount <> 0),
  constraint fear_events_type_valid
    check (event_type in ('adjustment', 'correction', 'undo', 'automatic'))
);

create index fear_events_campaign_created_idx
  on public.fear_events (campaign_id, created_at desc);
create index fear_events_operation_idx
  on public.fear_events (operation_id);

-- ---------------------------------------------------------------------------
-- countdowns
-- ---------------------------------------------------------------------------

create table public.countdowns (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  description text,
  category text not null,
  direction text not null,
  current_value integer not null,
  target_value integer not null,
  starting_value integer not null,
  status text not null default 'active',
  visibility text not null default 'gm',
  consequence text,
  linked_entity_type text,
  linked_entity_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint countdowns_name_not_blank check (char_length(btrim(name)) between 1 and 100),
  constraint countdowns_direction_valid check (direction in ('up', 'down')),
  constraint countdowns_status_valid
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  constraint countdowns_visibility_valid check (visibility in ('gm')),
  -- Boundaries must be consistent with the chosen direction.
  constraint countdowns_bounds_valid check (
    (direction = 'up' and starting_value <= target_value
      and current_value between starting_value and target_value)
    or
    (direction = 'down' and starting_value >= target_value
      and current_value between target_value and starting_value)
  )
);

create index countdowns_campaign_status_idx
  on public.countdowns (campaign_id, status);
create index countdowns_campaign_category_idx
  on public.countdowns (campaign_id, category);
create index countdowns_linked_entity_idx
  on public.countdowns (linked_entity_type, linked_entity_id);

create trigger countdowns_set_updated_at
  before update on public.countdowns
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- countdown_events (audit history for every countdown change)
-- ---------------------------------------------------------------------------

create table public.countdown_events (
  id uuid primary key default gen_random_uuid(),
  countdown_id uuid not null references public.countdowns (id) on delete cascade,
  operation_id uuid,
  change_amount integer not null,
  event_type text not null,
  reason text,
  previous_value integer not null,
  new_value integer not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  constraint countdown_events_type_valid
    check (event_type in (
      'advance', 'reverse', 'pause', 'resume',
      'complete', 'cancel', 'correction', 'undo'
    )),
  -- Value-changing events must move the value; state-only events must not.
  constraint countdown_events_change_consistent check (
    (event_type in ('advance', 'reverse', 'correction', 'undo') and change_amount <> 0)
    or
    (event_type in ('pause', 'resume', 'complete', 'cancel') and change_amount = 0)
  )
);

create index countdown_events_countdown_created_idx
  on public.countdown_events (countdown_id, created_at desc);
create index countdown_events_operation_idx
  on public.countdown_events (operation_id);

-- ---------------------------------------------------------------------------
-- characters
-- ---------------------------------------------------------------------------

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  pronouns text,
  ancestry text,
  community text,
  class_name text,
  subclass_name text,
  level integer not null default 1,
  portrait_url text,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint characters_name_not_blank check (char_length(btrim(name)) between 1 and 100),
  constraint characters_status_valid check (status in ('active', 'archived')),
  -- Daggerheart characters span levels 1-10.
  constraint characters_level_valid check (level between 1 and 10)
);

create index characters_campaign_status_idx
  on public.characters (campaign_id, status);

create trigger characters_set_updated_at
  before update on public.characters
  for each row
  execute function public.set_updated_at();
