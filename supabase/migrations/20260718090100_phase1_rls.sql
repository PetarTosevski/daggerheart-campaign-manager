-- Row-Level Security for all Phase 1 tables.
--
-- Ownership model: a user may access a campaign only when
-- campaigns.owner_id = auth.uid(). Child records are authorized through their
-- parent campaign. Countdown events are authorized through their countdown's
-- campaign.

-- ---------------------------------------------------------------------------
-- Authorization helpers
-- ---------------------------------------------------------------------------

create or replace function public.owns_campaign(target_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaigns c
    where c.id = target_campaign_id
      and c.owner_id = auth.uid()
  );
$$;

create or replace function public.owns_countdown(target_countdown_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.countdowns cd
    join public.campaigns c on c.id = cd.campaign_id
    where cd.id = target_countdown_id
      and c.owner_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------

alter table public.campaigns enable row level security;

create policy campaigns_select_own on public.campaigns
  for select using (owner_id = auth.uid());

create policy campaigns_insert_own on public.campaigns
  for insert with check (owner_id = auth.uid());

create policy campaigns_update_own on public.campaigns
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy campaigns_delete_own on public.campaigns
  for delete using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- campaign_state
-- ---------------------------------------------------------------------------

alter table public.campaign_state enable row level security;

create policy campaign_state_select_own on public.campaign_state
  for select using (public.owns_campaign(campaign_id));

create policy campaign_state_insert_own on public.campaign_state
  for insert with check (public.owns_campaign(campaign_id));

create policy campaign_state_update_own on public.campaign_state
  for update using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

create policy campaign_state_delete_own on public.campaign_state
  for delete using (public.owns_campaign(campaign_id));

-- ---------------------------------------------------------------------------
-- fear_events
-- ---------------------------------------------------------------------------

alter table public.fear_events enable row level security;

create policy fear_events_select_own on public.fear_events
  for select using (public.owns_campaign(campaign_id));

create policy fear_events_insert_own on public.fear_events
  for insert with check (
    public.owns_campaign(campaign_id) and created_by = auth.uid()
  );

create policy fear_events_update_own on public.fear_events
  for update using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

create policy fear_events_delete_own on public.fear_events
  for delete using (public.owns_campaign(campaign_id));

-- ---------------------------------------------------------------------------
-- countdowns
-- ---------------------------------------------------------------------------

alter table public.countdowns enable row level security;

create policy countdowns_select_own on public.countdowns
  for select using (public.owns_campaign(campaign_id));

create policy countdowns_insert_own on public.countdowns
  for insert with check (public.owns_campaign(campaign_id));

create policy countdowns_update_own on public.countdowns
  for update using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

create policy countdowns_delete_own on public.countdowns
  for delete using (public.owns_campaign(campaign_id));

-- ---------------------------------------------------------------------------
-- countdown_events
-- ---------------------------------------------------------------------------

alter table public.countdown_events enable row level security;

create policy countdown_events_select_own on public.countdown_events
  for select using (public.owns_countdown(countdown_id));

create policy countdown_events_insert_own on public.countdown_events
  for insert with check (
    public.owns_countdown(countdown_id) and created_by = auth.uid()
  );

create policy countdown_events_update_own on public.countdown_events
  for update using (public.owns_countdown(countdown_id))
  with check (public.owns_countdown(countdown_id));

create policy countdown_events_delete_own on public.countdown_events
  for delete using (public.owns_countdown(countdown_id));

-- ---------------------------------------------------------------------------
-- characters
-- ---------------------------------------------------------------------------

alter table public.characters enable row level security;

create policy characters_select_own on public.characters
  for select using (public.owns_campaign(campaign_id));

create policy characters_insert_own on public.characters
  for insert with check (public.owns_campaign(campaign_id));

create policy characters_update_own on public.characters
  for update using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

create policy characters_delete_own on public.characters
  for delete using (public.owns_campaign(campaign_id));

-- ---------------------------------------------------------------------------
-- Grants (RLS still governs row access)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.campaign_state to authenticated;
grant select, insert, update, delete on public.fear_events to authenticated;
grant select, insert, update, delete on public.countdowns to authenticated;
grant select, insert, update, delete on public.countdown_events to authenticated;
grant select, insert, update, delete on public.characters to authenticated;
