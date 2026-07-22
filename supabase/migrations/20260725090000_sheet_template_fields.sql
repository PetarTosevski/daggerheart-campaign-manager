-- Task 011B: interactive field definitions overlaid on a template version's PDF
-- pages, plus a draft/published layout lifecycle.
--
-- Coordinates are stored normalized to page bounds (x, y, width, height in
-- [0, 1]) so a field's placement is independent of viewport pixels and survives
-- zoom. This migration stores field DEFINITIONS only; no runtime character
-- values are created here (that is Task 011C).

-- ---------------------------------------------------------------------------
-- Layout lifecycle on versions
-- ---------------------------------------------------------------------------
--
-- A version's field layout starts as an editable draft. Publishing freezes the
-- field definitions (immutable in place); a later edit clones a published
-- version into a new draft revision.

alter table public.sheet_template_versions
  add column layout_status text not null default 'draft',
  add column published_at timestamptz,
  add constraint sheet_template_versions_layout_status_valid
    check (layout_status in ('draft', 'published'));

-- ---------------------------------------------------------------------------
-- sheet_template_fields
-- ---------------------------------------------------------------------------

create table public.sheet_template_fields (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  template_version_id uuid not null,
  field_key text not null,
  label text not null,
  field_type text not null,
  page_number integer not null,
  x numeric not null,
  y numeric not null,
  width numeric not null,
  height numeric not null,
  configuration jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  is_required boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Stable, machine-usable keys: lowercase, start with a letter, <= 64 chars.
  constraint sheet_template_fields_key_format
    check (field_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint sheet_template_fields_label_valid
    check (char_length(btrim(label)) between 1 and 100),
  constraint sheet_template_fields_type_valid
    check (field_type in (
      'text', 'multiline_text', 'number', 'checkbox', 'select',
      'radio', 'image', 'counter', 'computed'
    )),
  constraint sheet_template_fields_page_valid check (page_number >= 1),
  -- Normalized coordinates fully inside the page.
  constraint sheet_template_fields_coords_valid check (
    x >= 0 and x <= 1 and y >= 0 and y <= 1
    and width > 0 and width <= 1 and height > 0 and height <= 1
    and x + width <= 1 and y + height <= 1
  ),
  constraint sheet_template_fields_config_object
    check (jsonb_typeof(configuration) = 'object'),
  -- A field can only belong to a version in the same campaign.
  constraint sheet_template_fields_version_same_campaign_fkey
    foreign key (campaign_id, template_version_id)
    references public.sheet_template_versions (campaign_id, id)
    on delete cascade
);

-- One active field key per version (case-insensitive). Deactivated fields do not
-- reserve their key, so a key can be reused after deactivation.
create unique index sheet_template_fields_version_key_unique
  on public.sheet_template_fields (template_version_id, lower(field_key))
  where is_active;

create index sheet_template_fields_version_page_idx
  on public.sheet_template_fields (template_version_id, page_number, display_order);
create index sheet_template_fields_campaign_idx
  on public.sheet_template_fields (campaign_id);

alter table public.sheet_template_fields enable row level security;

create policy sheet_template_fields_select_own on public.sheet_template_fields
  for select using (public.owns_campaign(campaign_id));

-- Writes flow only through the owner-authorized functions below.
grant select on public.sheet_template_fields to authenticated;

-- ---------------------------------------------------------------------------
-- save_sheet_template_fields: replace a draft version's field set
-- ---------------------------------------------------------------------------
--
-- Accepts the full field set as JSON and atomically replaces the version's
-- fields. Rejects edits to a published version, invalid types, out-of-range
-- pages/coordinates, malformed keys, and duplicate active keys. The client edits
-- fields in memory (add/move/resize/duplicate/deactivate/delete) and calls this
-- once to persist the layout.

create function public.save_sheet_template_fields(
  p_template_version_id uuid,
  p_fields jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign_id uuid;
  v_layout_status text;
  v_page_count integer;
  v_field jsonb;
  v_index integer := 0;
  v_saved integer := 0;
  v_seen_keys text[] := array[]::text[];
  v_key text;
  v_type text;
  v_page integer;
  v_active boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_template_version_id is null then
    raise exception using errcode = '22023', message = 'A template version is required.';
  end if;

  select version.campaign_id, version.layout_status, version.page_count
  into v_campaign_id, v_layout_status, v_page_count
  from public.sheet_template_versions as version
  join public.campaigns as campaign on campaign.id = version.campaign_id
  where version.id = p_template_version_id
    and campaign.owner_id = v_user_id
  for update of version;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Template version not found or access denied.';
  end if;

  if v_layout_status <> 'draft' then
    raise exception using
      errcode = '22023',
      message = 'Published layouts cannot be edited; create a revision.';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'array' then
    raise exception using errcode = '22023', message = 'Fields must be an array.';
  end if;

  -- Replace the whole set for this version.
  delete from public.sheet_template_fields where template_version_id = p_template_version_id;

  for v_field in select * from jsonb_array_elements(p_fields)
  loop
    v_key := btrim(v_field->>'field_key');
    v_type := v_field->>'field_type';
    v_page := (v_field->>'page_number')::integer;
    v_active := coalesce((v_field->>'is_active')::boolean, true);

    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,63}$' then
      raise exception using errcode = '22023',
        message = format('Invalid field key: %s', coalesce(v_key, '(null)'));
    end if;

    if v_type is null or v_type not in (
      'text', 'multiline_text', 'number', 'checkbox', 'select',
      'radio', 'image', 'counter', 'computed'
    ) then
      raise exception using errcode = '22023',
        message = format('Unsupported field type: %s', coalesce(v_type, '(null)'));
    end if;

    if v_page is null or v_page < 1 or v_page > v_page_count then
      raise exception using errcode = '22023',
        message = format('Field %s references an invalid page.', v_key);
    end if;

    -- Duplicate active key check within the submitted set.
    if v_active then
      if lower(v_key) = any (v_seen_keys) then
        raise exception using errcode = '22023',
          message = format('Duplicate field key: %s', v_key);
      end if;
      v_seen_keys := array_append(v_seen_keys, lower(v_key));
    end if;

    insert into public.sheet_template_fields (
      campaign_id, template_version_id, field_key, label, field_type,
      page_number, x, y, width, height, configuration, display_order,
      is_required, is_active
    )
    values (
      v_campaign_id,
      p_template_version_id,
      v_key,
      btrim(v_field->>'label'),
      v_type,
      v_page,
      (v_field->>'x')::numeric,
      (v_field->>'y')::numeric,
      (v_field->>'width')::numeric,
      (v_field->>'height')::numeric,
      coalesce(v_field->'configuration', '{}'::jsonb),
      coalesce((v_field->>'display_order')::integer, v_index),
      coalesce((v_field->>'is_required')::boolean, false),
      v_active
    );

    v_index := v_index + 1;
    v_saved := v_saved + 1;
  end loop;

  return v_saved;
end;
$$;

-- ---------------------------------------------------------------------------
-- publish_sheet_template_version: freeze a draft layout and make it active
-- ---------------------------------------------------------------------------

create function public.publish_sheet_template_version(
  p_template_version_id uuid
)
returns table (
  version_id uuid,
  returned_layout_status text,
  returned_published_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign_id uuid;
  v_template_id uuid;
  v_layout_status text;
  v_published_at timestamptz;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select version.campaign_id, version.template_id, version.layout_status
  into v_campaign_id, v_template_id, v_layout_status
  from public.sheet_template_versions as version
  join public.campaigns as campaign on campaign.id = version.campaign_id
  where version.id = p_template_version_id
    and campaign.owner_id = v_user_id
  for update of version;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Template version not found or access denied.';
  end if;

  if v_layout_status = 'published' then
    raise exception using
      errcode = '22023',
      message = 'This version is already published.';
  end if;

  v_published_at := now();

  update public.sheet_template_versions
  set layout_status = 'published', published_at = v_published_at
  where id = p_template_version_id;

  -- Publishing makes this version the template's active version.
  update public.sheet_templates
  set active_version_id = p_template_version_id
  where id = v_template_id;

  return query
    select p_template_version_id, 'published'::text, v_published_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_sheet_template_revision: clone a published version into a new draft
-- ---------------------------------------------------------------------------
--
-- The server copies the immutable PDF object to the new version's path first,
-- then calls this to create the new draft version (reusing the source PDF
-- metadata) and copy the source field definitions. active_version_id is left
-- unchanged until the revision is published.

create function public.create_sheet_template_revision(
  p_source_version_id uuid,
  p_new_version_id uuid,
  p_new_object_path text
)
returns table (
  version_id uuid,
  returned_version_number integer,
  returned_layout_status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_source public.sheet_template_versions%rowtype;
  v_next_version integer;
  v_expected_path text;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_source_version_id is null or p_new_version_id is null then
    raise exception using errcode = '22023', message = 'Source and new version ids are required.';
  end if;

  select version.*
  into v_source
  from public.sheet_template_versions as version
  join public.campaigns as campaign on campaign.id = version.campaign_id
  where version.id = p_source_version_id
    and campaign.owner_id = v_user_id
  for update of version;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Template version not found or access denied.';
  end if;

  if v_source.layout_status <> 'published' then
    raise exception using
      errcode = '22023',
      message = 'Only a published version can be revised.';
  end if;

  v_expected_path :=
    v_source.campaign_id::text || '/' || v_source.template_id::text || '/' ||
    p_new_version_id::text || '/source.pdf';
  if p_new_object_path is distinct from v_expected_path then
    raise exception using errcode = '22023', message = 'The storage path is invalid.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.sheet_template_versions
  where template_id = v_source.template_id;

  insert into public.sheet_template_versions (
    id, campaign_id, template_id, version_number, source_bucket,
    source_object_path, original_filename, mime_type, size_bytes, checksum,
    page_count, status, layout_status, created_by
  )
  values (
    p_new_version_id, v_source.campaign_id, v_source.template_id, v_next_version,
    v_source.source_bucket, p_new_object_path, v_source.original_filename,
    v_source.mime_type, v_source.size_bytes, v_source.checksum,
    v_source.page_count, 'active', 'draft', v_user_id
  );

  -- Copy the published field definitions into the new draft.
  insert into public.sheet_template_fields (
    campaign_id, template_version_id, field_key, label, field_type,
    page_number, x, y, width, height, configuration, display_order,
    is_required, is_active
  )
  select
    campaign_id, p_new_version_id, field_key, label, field_type,
    page_number, x, y, width, height, configuration, display_order,
    is_required, is_active
  from public.sheet_template_fields
  where template_version_id = p_source_version_id;

  return query
    select p_new_version_id, v_next_version, 'draft'::text;
end;
$$;

revoke all on function public.save_sheet_template_fields(uuid, jsonb) from public, anon;
grant execute on function public.save_sheet_template_fields(uuid, jsonb) to authenticated;

revoke all on function public.publish_sheet_template_version(uuid) from public, anon;
grant execute on function public.publish_sheet_template_version(uuid) to authenticated;

revoke all on function public.create_sheet_template_revision(uuid, uuid, text)
  from public, anon;
grant execute on function public.create_sheet_template_revision(uuid, uuid, text)
  to authenticated;
