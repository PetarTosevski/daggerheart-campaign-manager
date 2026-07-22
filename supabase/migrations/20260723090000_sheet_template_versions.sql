-- Task 011A: PDF template storage and rendering foundation.
--
-- Adds immutable, campaign-scoped character-sheet-template PDF versions backed by
-- a private Supabase Storage bucket, plus the owner-authorized functions used to
-- create and archive versions. Rendering, page navigation, and zoom are handled
-- in the application; the database stores only immutable version metadata and the
-- pointer to a template's active version.
--
-- Out of scope (Tasks 011B–011C and later): field definitions, coordinate/overlay
-- editing, interactive sheet runtime, and character sheet values. This migration
-- adds none of those structures.

-- ---------------------------------------------------------------------------
-- sheet_template_versions
-- ---------------------------------------------------------------------------

create table public.sheet_template_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  template_id uuid not null,
  version_number integer not null,
  source_bucket text not null,
  source_object_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  checksum text not null,
  page_count integer not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  constraint sheet_template_versions_status_valid
    check (status in ('active', 'archived')),
  constraint sheet_template_versions_mime_pdf
    check (mime_type = 'application/pdf'),
  constraint sheet_template_versions_bucket_valid
    check (source_bucket = 'character-sheet-templates'),
  constraint sheet_template_versions_size_valid
    check (size_bytes > 0 and size_bytes <= 26214400),
  constraint sheet_template_versions_page_count_valid
    check (page_count between 1 and 100),
  constraint sheet_template_versions_version_positive
    check (version_number >= 1),
  constraint sheet_template_versions_checksum_not_blank
    check (char_length(btrim(checksum)) between 1 and 128),
  constraint sheet_template_versions_filename_not_blank
    check (char_length(btrim(original_filename)) between 1 and 300),
  -- One immutable object per version; new PDFs create new versions/paths.
  constraint sheet_template_versions_object_path_unique unique (source_object_path),
  constraint sheet_template_versions_template_version_unique
    unique (template_id, version_number),
  -- Supports the same-campaign composite foreign key from sheet_templates.
  constraint sheet_template_versions_campaign_id_id_unique unique (campaign_id, id),
  -- A version can only belong to a template in the same campaign.
  constraint sheet_template_versions_template_same_campaign_fkey
    foreign key (campaign_id, template_id)
    references public.sheet_templates (campaign_id, id)
    on delete cascade
);

create index sheet_template_versions_template_idx
  on public.sheet_template_versions (template_id, version_number desc);
create index sheet_template_versions_campaign_idx
  on public.sheet_template_versions (campaign_id);

-- ---------------------------------------------------------------------------
-- sheet_templates.active_version_id
-- ---------------------------------------------------------------------------
--
-- Points at the version currently rendered for a template. The composite,
-- same-campaign foreign key is DEFERRABLE INITIALLY DEFERRED so a full template
-- or campaign cascade delete succeeds within one transaction, while a normal
-- attempt to delete a still-referenced (active) version fails at commit. This is
-- how "referenced versions cannot be silently deleted" is enforced.

alter table public.sheet_templates
  add column active_version_id uuid;

alter table public.sheet_templates
  add constraint sheet_templates_active_version_same_campaign_fkey
    foreign key (campaign_id, active_version_id)
    references public.sheet_template_versions (campaign_id, id)
    deferrable initially deferred;

create index sheet_templates_active_version_idx
  on public.sheet_templates (active_version_id)
  where active_version_id is not null;

-- ---------------------------------------------------------------------------
-- Row-Level Security (version metadata)
-- ---------------------------------------------------------------------------

alter table public.sheet_template_versions enable row level security;

create policy sheet_template_versions_select_own on public.sheet_template_versions
  for select using (public.owns_campaign(campaign_id));

-- Deletion is permitted for owners (used for GM-initiated removal); the deferred
-- active-version foreign key still blocks removing a referenced version.
create policy sheet_template_versions_delete_own on public.sheet_template_versions
  for delete using (public.owns_campaign(campaign_id));

-- Inserts and updates flow only through the security-definer functions below so
-- version numbering, immutable metadata, and the active pointer stay consistent.
grant select, delete on public.sheet_template_versions to authenticated;

-- ---------------------------------------------------------------------------
-- Private Storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'character-sheet-templates',
  'character-sheet-templates',
  false,
  26214400,
  array['application/pdf']
)
on conflict (id) do nothing;

-- Storage authorization: an owner may read, upload, and remove objects only
-- under their own campaign's folder. Object paths are
-- {campaignId}/{templateId}/{versionId}/source.pdf, so the first path segment is
-- the campaign id. No UPDATE policy exists, so originals cannot be overwritten.

create policy "sheet templates read own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'character-sheet-templates'
    and public.owns_campaign(((storage.foldername(name))[1])::uuid)
  );

create policy "sheet templates upload own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'character-sheet-templates'
    and public.owns_campaign(((storage.foldername(name))[1])::uuid)
  );

create policy "sheet templates delete own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'character-sheet-templates'
    and public.owns_campaign(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- create_sheet_template_version
-- ---------------------------------------------------------------------------
--
-- Called by the server after it has validated the PDF (signature, MIME, size,
-- corruption) and uploaded the immutable object to storage at the deterministic
-- path. The version id is generated by the server so it can build the path
-- before insert; this function assigns the next version number, records the
-- metadata, and atomically points the template at the new active version.

create function public.create_sheet_template_version(
  p_template_id uuid,
  p_version_id uuid,
  p_source_object_path text,
  p_original_filename text,
  p_size_bytes bigint,
  p_checksum text,
  p_page_count integer
)
returns table (
  version_id uuid,
  returned_template_id uuid,
  returned_version_number integer,
  returned_source_bucket text,
  returned_source_object_path text,
  returned_original_filename text,
  returned_size_bytes bigint,
  returned_checksum text,
  returned_page_count integer,
  returned_status text,
  version_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_campaign_id uuid;
  v_template_status text;
  v_filename text := btrim(p_original_filename);
  v_checksum text := btrim(p_checksum);
  v_next_version integer;
  v_expected_path text;
  v_version public.sheet_template_versions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_template_id is null or p_version_id is null then
    raise exception using errcode = '22023', message = 'A template and version id are required.';
  end if;

  select template.campaign_id, template.status
  into v_campaign_id, v_template_status
  from public.sheet_templates as template
  join public.campaigns as campaign on campaign.id = template.campaign_id
  where template.id = p_template_id
    and campaign.owner_id = v_user_id
  for update of template;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Template not found or access denied.';
  end if;

  if v_template_status <> 'active' then
    raise exception using
      errcode = '22023',
      message = 'The template is not active.';
  end if;

  if v_filename is null or char_length(v_filename) not between 1 and 300 then
    raise exception using errcode = '22023', message = 'A source filename is required.';
  end if;

  if v_checksum is null or char_length(v_checksum) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'A checksum is required.';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 26214400 then
    raise exception using errcode = '22023', message = 'The PDF size is invalid.';
  end if;

  if p_page_count is null or p_page_count not between 1 and 100 then
    raise exception using errcode = '22023', message = 'The PDF page count is invalid.';
  end if;

  -- The object path is server-derived and must match the deterministic layout so
  -- a caller cannot attach metadata that points at an arbitrary object.
  v_expected_path :=
    v_campaign_id::text || '/' || p_template_id::text || '/' ||
    p_version_id::text || '/source.pdf';
  if p_source_object_path is distinct from v_expected_path then
    raise exception using errcode = '22023', message = 'The storage path is invalid.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_next_version
  from public.sheet_template_versions
  where template_id = p_template_id;

  insert into public.sheet_template_versions (
    id,
    campaign_id,
    template_id,
    version_number,
    source_bucket,
    source_object_path,
    original_filename,
    mime_type,
    size_bytes,
    checksum,
    page_count,
    status,
    created_by
  )
  values (
    p_version_id,
    v_campaign_id,
    p_template_id,
    v_next_version,
    'character-sheet-templates',
    v_expected_path,
    v_filename,
    'application/pdf',
    p_size_bytes,
    v_checksum,
    p_page_count,
    'active',
    v_user_id
  )
  returning * into v_version;

  update public.sheet_templates
  set active_version_id = v_version.id
  where id = p_template_id;

  return query
    select
      v_version.id,
      v_version.template_id,
      v_version.version_number,
      v_version.source_bucket,
      v_version.source_object_path,
      v_version.original_filename,
      v_version.size_bytes,
      v_version.checksum,
      v_version.page_count,
      v_version.status,
      v_version.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- archive_sheet_template_version
-- ---------------------------------------------------------------------------
--
-- Marks a version archived. If it was the template's active version, the active
-- pointer is moved to the newest remaining active version (or cleared). Archival
-- never rewrites or removes the immutable object; it only changes lifecycle
-- state.

create function public.archive_sheet_template_version(
  p_version_id uuid
)
returns table (
  version_id uuid,
  returned_template_id uuid,
  returned_status text,
  returned_active_version_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_campaign_id uuid;
  v_active_version_id uuid;
  v_next_active uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_version_id is null then
    raise exception using errcode = '22023', message = 'A version is required.';
  end if;

  select version.template_id, version.campaign_id
  into v_template_id, v_campaign_id
  from public.sheet_template_versions as version
  join public.campaigns as campaign on campaign.id = version.campaign_id
  where version.id = p_version_id
    and campaign.owner_id = v_user_id
  for update of version;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Version not found or access denied.';
  end if;

  update public.sheet_template_versions
  set status = 'archived'
  where id = p_version_id;

  select active_version_id into v_active_version_id
  from public.sheet_templates
  where id = v_template_id
  for update;

  if v_active_version_id = p_version_id then
    select id into v_next_active
    from public.sheet_template_versions
    where template_id = v_template_id
      and status = 'active'
      and id <> p_version_id
    order by version_number desc
    limit 1;

    update public.sheet_templates
    set active_version_id = v_next_active
    where id = v_template_id;

    v_active_version_id := v_next_active;
  end if;

  return query
    select p_version_id, v_template_id, 'archived'::text, v_active_version_id;
end;
$$;

revoke all on function public.create_sheet_template_version(
  uuid, uuid, text, text, bigint, text, integer
) from public;
revoke all on function public.create_sheet_template_version(
  uuid, uuid, text, text, bigint, text, integer
) from anon;
grant execute on function public.create_sheet_template_version(
  uuid, uuid, text, text, bigint, text, integer
) to authenticated;

revoke all on function public.archive_sheet_template_version(uuid) from public;
revoke all on function public.archive_sheet_template_version(uuid) from anon;
grant execute on function public.archive_sheet_template_version(uuid) to authenticated;
