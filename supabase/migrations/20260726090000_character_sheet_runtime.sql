-- Task 011C: interactive character-sheet runtime.
--
-- Pins each character to a specific immutable, published template version and
-- stores character-specific field values SEPARATELY from the template. The
-- source PDF and published field definitions are never modified by editing a
-- character. Runtime code reads the character's pinned version — never
-- sheet_templates.active_version_id dynamically — so publishing a newer version
-- cannot change an existing character's layout.

-- ---------------------------------------------------------------------------
-- Version pinning on characters
-- ---------------------------------------------------------------------------

-- Support composite same-campaign foreign keys that target characters and
-- fields (both already have a primary key on id).
alter table public.characters
  add constraint characters_campaign_id_id_unique unique (campaign_id, id);

alter table public.sheet_template_fields
  add constraint sheet_template_fields_campaign_id_id_unique unique (campaign_id, id);

alter table public.characters
  add column sheet_template_version_id uuid;

-- Same-campaign pin; on version delete only the pin column is nulled (never the
-- NOT NULL campaign_id). A character never silently loses its campaign.
alter table public.characters
  add constraint characters_pinned_version_same_campaign_fkey
    foreign key (campaign_id, sheet_template_version_id)
    references public.sheet_template_versions (campaign_id, id)
    on delete set null (sheet_template_version_id);

create index characters_pinned_version_idx
  on public.characters (sheet_template_version_id)
  where sheet_template_version_id is not null;

-- ---------------------------------------------------------------------------
-- character_sheet_values
-- ---------------------------------------------------------------------------
--
-- One value per character and template field, tied to the specific published
-- field (and therefore version). Values are text-serialized; `value_type` and
-- `field_key` snapshot the field at write time for robustness.

create table public.character_sheet_values (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  character_id uuid not null,
  template_field_id uuid not null,
  field_key text not null,
  value text,
  value_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_sheet_values_type_valid
    check (value_type in (
      'text', 'multiline_text', 'number', 'checkbox', 'select',
      'radio', 'image', 'counter', 'computed'
    )),
  constraint character_sheet_values_character_field_unique
    unique (character_id, template_field_id),
  -- Cross-campaign protection: the value, its character, and its field must all
  -- be in the same campaign.
  constraint character_sheet_values_character_same_campaign_fkey
    foreign key (campaign_id, character_id)
    references public.characters (campaign_id, id) on delete cascade,
  constraint character_sheet_values_field_same_campaign_fkey
    foreign key (campaign_id, template_field_id)
    references public.sheet_template_fields (campaign_id, id) on delete cascade
);

create index character_sheet_values_character_idx
  on public.character_sheet_values (character_id);
create index character_sheet_values_campaign_idx
  on public.character_sheet_values (campaign_id);

create trigger character_sheet_values_set_updated_at
  before update on public.character_sheet_values
  for each row
  execute function public.set_updated_at();

alter table public.character_sheet_values enable row level security;

create policy character_sheet_values_select_own on public.character_sheet_values
  for select using (public.owns_campaign(campaign_id));

-- Writes flow only through save_character_sheet_value.
grant select on public.character_sheet_values to authenticated;

-- ---------------------------------------------------------------------------
-- save_character_sheet_value: validated, owner-authorized autosave upsert
-- ---------------------------------------------------------------------------
--
-- Validates ownership, that the field belongs to the character's pinned version,
-- that the field is editable (not computed/read-only), and that the value is
-- valid for the field type. Uses updated_at as an optimistic-concurrency guard:
-- a stale expected timestamp is rejected so a delayed write cannot clobber a
-- newer edit.

create function public.save_character_sheet_value(
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
  where character.id = p_character_id
    and campaign.owner_id = v_user_id
  for update of character;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Character not found or access denied.';
  end if;

  if v_pinned_version is null then
    raise exception using
      errcode = '22023',
      message = 'Character has no pinned template version.';
  end if;

  select field.*
  into v_field
  from public.sheet_template_fields as field
  where field.id = p_template_field_id
    and field.campaign_id = v_campaign_id;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Field not found in this campaign.';
  end if;

  if v_field.template_version_id <> v_pinned_version then
    raise exception using
      errcode = '22023',
      message = 'Field does not belong to the character''s pinned version.';
  end if;

  if not v_field.is_active then
    raise exception using errcode = '22023', message = 'Field is not active.';
  end if;

  v_readonly := coalesce((v_field.configuration->>'readOnly')::boolean, false);
  if v_field.field_type = 'computed' or v_readonly then
    raise exception using
      errcode = '22023',
      message = 'Computed and read-only fields cannot be edited.';
  end if;

  -- Normalize/validate by type. A null/empty value clears the field.
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
        select 1
        from jsonb_array_elements_text(coalesce(v_field.configuration->'options', '[]'::jsonb)) as opt
        where opt = v_value
      ) then
        raise exception using errcode = '22023', message = 'Value is not an allowed option.';
      end if;
    else
      -- text, multiline_text, image
      if char_length(v_value) > 10000 then
        raise exception using errcode = '22023', message = 'Value is too long.';
      end if;
    end if;
  end if;

  select existing.*
  into v_existing
  from public.character_sheet_values as existing
  where existing.character_id = p_character_id
    and existing.template_field_id = p_template_field_id
  for update;

  if found then
    -- Optimistic concurrency: reject a write based on a stale snapshot.
    if p_expected_updated_at is null
       or v_existing.updated_at <> p_expected_updated_at then
      raise exception using
        errcode = '40001',
        message = 'The value changed since you last loaded it.';
    end if;

    update public.character_sheet_values
    set value = v_value,
        value_type = v_field.field_type,
        field_key = v_field.field_key
    where id = v_existing.id
    returning * into v_result;
  else
    if p_expected_updated_at is not null then
      raise exception using
        errcode = '40001',
        message = 'The value changed since you last loaded it.';
    end if;

    insert into public.character_sheet_values (
      campaign_id, character_id, template_field_id, field_key, value, value_type
    )
    values (
      v_campaign_id, p_character_id, p_template_field_id,
      v_field.field_key, v_value, v_field.field_type
    )
    returning * into v_result;
  end if;

  return query select v_result.id, v_result.value, v_result.updated_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- pin_character_sheet_version: deliberate one-time assignment
-- ---------------------------------------------------------------------------
--
-- Assigns a character (with a template but no pinned version) to that template's
-- current active version, but ONLY when that version is published. Never
-- reassigns an already-pinned character (no silent upgrades) and never assigns a
-- draft. Used to reconcile pre-existing characters via an explicit GM action.

create function public.pin_character_sheet_version(
  p_character_id uuid
)
returns table (
  returned_version_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign_id uuid;
  v_template_id uuid;
  v_pinned uuid;
  v_active uuid;
  v_layout text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select character.campaign_id, character.sheet_template_id,
         character.sheet_template_version_id
  into v_campaign_id, v_template_id, v_pinned
  from public.characters as character
  join public.campaigns as campaign on campaign.id = character.campaign_id
  where character.id = p_character_id
    and campaign.owner_id = v_user_id
  for update of character;

  if not found then
    raise exception using errcode = '42501', message = 'Character not found or access denied.';
  end if;

  if v_pinned is not null then
    raise exception using errcode = '22023', message = 'Character is already pinned to a version.';
  end if;

  if v_template_id is null then
    raise exception using errcode = '22023', message = 'Character has no template assigned.';
  end if;

  select template.active_version_id into v_active
  from public.sheet_templates as template
  where template.id = v_template_id;

  if v_active is null then
    raise exception using errcode = '22023', message = 'The template has no active version.';
  end if;

  select version.layout_status into v_layout
  from public.sheet_template_versions as version
  where version.id = v_active;

  if v_layout is distinct from 'published' then
    raise exception using errcode = '22023', message = 'The template has no published version to assign.';
  end if;

  update public.characters
  set sheet_template_version_id = v_active
  where id = p_character_id;

  return query select v_active;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_character: pin the published version at creation (reconciliation)
-- ---------------------------------------------------------------------------
--
-- Same signature/return as Task 010; additionally pins the character to the
-- selected template's current active version when that version is published.
-- Templates without a published version leave the pin null (the runtime then
-- shows a controlled "assign version" state).

create or replace function public.create_character(
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
  v_pinned_version uuid;
  v_layout text;
  v_character public.characters%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_campaign_id is null then
    raise exception using errcode = '22023', message = 'A campaign is required.';
  end if;

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
    raise exception using errcode = '22023', message = 'Select a class for the character.';
  end if;

  if not exists (
    select 1 from public.character_classes as class
    where class.id = p_class_id and class.campaign_id = p_campaign_id and class.is_active
  ) then
    raise exception using
      errcode = '22023',
      message = 'The selected class is unavailable for this campaign.';
  end if;

  if p_sheet_template_id is not null
     and not exists (
       select 1 from public.sheet_templates as template
       where template.id = p_sheet_template_id
         and template.campaign_id = p_campaign_id
         and template.status = 'active'
     ) then
    raise exception using
      errcode = '22023',
      message = 'The selected sheet template is unavailable for this campaign.';
  end if;

  -- Pin the template's active version only when it is published.
  if p_sheet_template_id is not null then
    select template.active_version_id into v_pinned_version
    from public.sheet_templates as template
    where template.id = p_sheet_template_id;

    if v_pinned_version is not null then
      select version.layout_status into v_layout
      from public.sheet_template_versions as version
      where version.id = v_pinned_version;
      if v_layout is distinct from 'published' then
        v_pinned_version := null;
      end if;
    end if;
  end if;

  insert into public.characters (
    campaign_id, name, class_id, sheet_template_id, sheet_template_version_id,
    notes, status
  )
  values (
    p_campaign_id, v_name, p_class_id, p_sheet_template_id, v_pinned_version,
    v_notes, 'active'
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

revoke all on function public.save_character_sheet_value(uuid, uuid, text, timestamptz)
  from public, anon;
grant execute on function public.save_character_sheet_value(uuid, uuid, text, timestamptz)
  to authenticated;

revoke all on function public.pin_character_sheet_version(uuid) from public, anon;
grant execute on function public.pin_character_sheet_version(uuid) to authenticated;
