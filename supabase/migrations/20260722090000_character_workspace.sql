-- Task 010: Character workspace and creation foundation.
--
-- Introduces campaign-scoped character classes and sheet templates, links the
-- existing characters table to a chosen class and template, and adds the
-- transactional, owner-authorized functions the guided character builder and
-- workspace use to create and edit characters.
--
-- Cross-campaign integrity is enforced structurally: each referenceable table
-- carries a unique (campaign_id, id) key, and every cross-table reference uses a
-- composite (campaign_id, <ref>_id) foreign key. A class, template, and
-- character can therefore only ever reference rows inside the same campaign.
--
-- This migration deliberately does NOT add PDF storage, template versions,
-- template fields, sheet field values, or any asset/media columns. Those belong
-- to Tasks 011A-011C and later asset tasks and are out of scope here.

-- ---------------------------------------------------------------------------
-- character_classes
-- ---------------------------------------------------------------------------

create table public.character_classes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  description text,
  -- Populated by a composite foreign key added after sheet_templates exists.
  default_template_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_classes_name_not_blank
    check (char_length(btrim(name)) between 1 and 100),
  -- Supports same-campaign composite foreign keys from sheet_templates and
  -- characters back to a class.
  constraint character_classes_campaign_id_id_unique unique (campaign_id, id)
);

create index character_classes_campaign_active_idx
  on public.character_classes (campaign_id, is_active);

create trigger character_classes_set_updated_at
  before update on public.character_classes
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sheet_templates
-- ---------------------------------------------------------------------------

create table public.sheet_templates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null,
  class_id uuid,
  is_blank_template boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sheet_templates_name_not_blank
    check (char_length(btrim(name)) between 1 and 100),
  constraint sheet_templates_status_valid
    check (status in ('active', 'archived')),
  constraint sheet_templates_campaign_id_id_unique unique (campaign_id, id),
  -- A template may optionally belong to a class, but only one in the same
  -- campaign. Deleting the class detaches the template rather than removing it.
  -- Only class_id is nulled; campaign_id (NOT NULL) is left intact.
  constraint sheet_templates_class_same_campaign_fkey
    foreign key (campaign_id, class_id)
    references public.character_classes (campaign_id, id)
    on delete set null (class_id)
);

-- At most one blank template per campaign so the builder's blank fallback is
-- unambiguous.
create unique index sheet_templates_one_blank_per_campaign_idx
  on public.sheet_templates (campaign_id)
  where is_blank_template;

create index sheet_templates_campaign_status_idx
  on public.sheet_templates (campaign_id, status);
create index sheet_templates_campaign_class_idx
  on public.sheet_templates (campaign_id, class_id);

create trigger sheet_templates_set_updated_at
  before update on public.sheet_templates
  for each row
  execute function public.set_updated_at();

-- Now that sheet_templates exists, wire a class's suggested default template as
-- a same-campaign composite foreign key.
alter table public.character_classes
  add constraint character_classes_default_template_same_campaign_fkey
    foreign key (campaign_id, default_template_id)
    references public.sheet_templates (campaign_id, id)
    on delete set null (default_template_id);

-- ---------------------------------------------------------------------------
-- characters: link to a chosen class and a chosen sheet template
-- ---------------------------------------------------------------------------
--
-- Both columns are nullable so pre-existing character rows remain valid and so a
-- campaign with no classes/templates yet is still representable. The guided
-- builder always assigns them through create_character(). Once a character is
-- created, its sheet_template_id is fixed data: nothing in this migration ever
-- rewrites it in response to later class or template changes.

alter table public.characters
  add column class_id uuid,
  add column sheet_template_id uuid;

alter table public.characters
  add constraint characters_class_same_campaign_fkey
    foreign key (campaign_id, class_id)
    references public.character_classes (campaign_id, id)
    on delete set null (class_id),
  add constraint characters_template_same_campaign_fkey
    foreign key (campaign_id, sheet_template_id)
    references public.sheet_templates (campaign_id, id)
    on delete set null (sheet_template_id);

create index characters_campaign_class_idx
  on public.characters (campaign_id, class_id);
create index characters_campaign_template_idx
  on public.characters (campaign_id, sheet_template_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.character_classes enable row level security;

create policy character_classes_select_own on public.character_classes
  for select using (public.owns_campaign(campaign_id));

create policy character_classes_insert_own on public.character_classes
  for insert with check (public.owns_campaign(campaign_id));

create policy character_classes_update_own on public.character_classes
  for update using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

create policy character_classes_delete_own on public.character_classes
  for delete using (public.owns_campaign(campaign_id));

alter table public.sheet_templates enable row level security;

create policy sheet_templates_select_own on public.sheet_templates
  for select using (public.owns_campaign(campaign_id));

create policy sheet_templates_insert_own on public.sheet_templates
  for insert with check (public.owns_campaign(campaign_id));

create policy sheet_templates_update_own on public.sheet_templates
  for update using (public.owns_campaign(campaign_id))
  with check (public.owns_campaign(campaign_id));

create policy sheet_templates_delete_own on public.sheet_templates
  for delete using (public.owns_campaign(campaign_id));

grant select, insert, update, delete on public.character_classes to authenticated;
grant select, insert, update, delete on public.sheet_templates to authenticated;

-- ---------------------------------------------------------------------------
-- create_character: guided-builder creation path
-- ---------------------------------------------------------------------------
--
-- Authorizes the campaign owner, validates the trimmed name, requires an active
-- same-campaign class, and accepts an optional active same-campaign template
-- (the builder resolves the suggested default/blank template before calling
-- this). All validation runs server-side and never trusts the client.

create function public.create_character(
  p_campaign_id uuid,
  p_name text,
  p_class_id uuid,
  p_sheet_template_id uuid,
  p_notes text
)
returns table (
  character_id uuid,
  returned_name text,
  returned_status text,
  returned_class_id uuid,
  returned_sheet_template_id uuid,
  character_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(p_name);
  v_notes text := nullif(btrim(p_notes), '');
  v_character public.characters%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_campaign_id is null then
    raise exception using errcode = '22023', message = 'A campaign is required.';
  end if;

  -- Lock the owned campaign; this also performs the ownership check.
  perform 1
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
    and campaign.owner_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Campaign not found or access denied.';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Character name must contain between 1 and 100 characters.';
  end if;

  if p_class_id is null then
    raise exception using
      errcode = '22023',
      message = 'Select a class for the character.';
  end if;

  if not exists (
    select 1
    from public.character_classes as class
    where class.id = p_class_id
      and class.campaign_id = p_campaign_id
      and class.is_active
  ) then
    raise exception using
      errcode = '22023',
      message = 'The selected class is unavailable for this campaign.';
  end if;

  -- The template is optional (a campaign may have none yet), but when supplied
  -- it must be an active template in the same campaign.
  if p_sheet_template_id is not null
     and not exists (
       select 1
       from public.sheet_templates as template
       where template.id = p_sheet_template_id
         and template.campaign_id = p_campaign_id
         and template.status = 'active'
     ) then
    raise exception using
      errcode = '22023',
      message = 'The selected sheet template is unavailable for this campaign.';
  end if;

  insert into public.characters (
    campaign_id,
    name,
    class_id,
    sheet_template_id,
    notes,
    status
  )
  values (
    p_campaign_id,
    v_name,
    p_class_id,
    p_sheet_template_id,
    v_notes,
    'active'
  )
  returning * into v_character;

  return query
    select
      v_character.id,
      v_character.name,
      v_character.status,
      v_character.class_id,
      v_character.sheet_template_id,
      v_character.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_character: Overview (name, status) and Notes persistence
-- ---------------------------------------------------------------------------
--
-- Class and template assignment are intentionally immutable here: this task
-- fixes them at creation time. A character never automatically changes its
-- template because of later class/template updates, and there is no manual
-- re-template flow in Task 010.

create function public.update_character(
  p_character_id uuid,
  p_name text,
  p_status text,
  p_notes text
)
returns table (
  character_id uuid,
  returned_name text,
  returned_status text,
  returned_notes text,
  character_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(p_name);
  v_status text := lower(btrim(p_status));
  v_notes text := nullif(btrim(p_notes), '');
  v_character public.characters%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_character_id is null then
    raise exception using errcode = '22023', message = 'A character is required.';
  end if;

  select character.*
  into v_character
  from public.characters as character
  join public.campaigns as campaign on campaign.id = character.campaign_id
  where character.id = p_character_id
    and campaign.owner_id = v_user_id
  for update of character;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Character not found or access denied.';
  end if;

  if v_name is null or char_length(v_name) not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Character name must contain between 1 and 100 characters.';
  end if;

  if v_status is null or v_status not in ('active', 'archived') then
    raise exception using
      errcode = '22023',
      message = 'Character status is not supported.';
  end if;

  update public.characters
  set name = v_name,
      status = v_status,
      notes = v_notes,
      archived_at = case
        when v_status = 'archived' and v_character.status <> 'archived'
          then now()
        when v_status = 'active'
          then null
        else v_character.archived_at
      end
  where id = p_character_id
  returning * into v_character;

  return query
    select
      v_character.id,
      v_character.name,
      v_character.status,
      v_character.notes,
      v_character.updated_at;
end;
$$;

revoke all on function public.create_character(uuid, text, uuid, uuid, text)
  from public;
revoke all on function public.create_character(uuid, text, uuid, uuid, text)
  from anon;
grant execute on function public.create_character(uuid, text, uuid, uuid, text)
  to authenticated;

revoke all on function public.update_character(uuid, text, text, text)
  from public;
revoke all on function public.update_character(uuid, text, text, text)
  from anon;
grant execute on function public.update_character(uuid, text, text, text)
  to authenticated;
