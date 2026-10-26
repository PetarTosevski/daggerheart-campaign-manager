-- Task 006: central operation identity, campaign-scoped idempotency, and
-- provenance links for future compound mutations.
--
-- This migration does not define undo eligibility or apply any domain effect.
-- Existing Fear and Countdown functions remain unchanged and continue to leave
-- operation_id null until a later approved compound workflow uses the link.

create table public.operations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  idempotency_key uuid not null,
  operation_type text not null,
  summary text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  metadata jsonb,
  reverses_operation_id uuid,
  constraint operations_type_valid
    check (char_length(btrim(operation_type)) between 1 and 100),
  constraint operations_summary_valid
    check (char_length(btrim(summary)) between 1 and 200),
  constraint operations_metadata_object
    check (metadata is null or jsonb_typeof(metadata) = 'object'),
  constraint operations_not_self_reversing
    check (reverses_operation_id is null or reverses_operation_id <> id),
  constraint operations_campaign_idempotency_unique
    unique (campaign_id, idempotency_key),
  constraint operations_campaign_id_id_unique
    unique (campaign_id, id),
  constraint operations_reversal_same_campaign_fkey
    foreign key (campaign_id, reverses_operation_id)
    references public.operations (campaign_id, id)
    on delete restrict
);

create index operations_campaign_created_idx
  on public.operations (campaign_id, created_at desc, id desc);
create index operations_reverses_operation_idx
  on public.operations (reverses_operation_id)
  where reverses_operation_id is not null;

alter table public.fear_events
  add constraint fear_events_operation_id_fkey
    foreign key (operation_id)
    references public.operations (id)
    on delete restrict;

alter table public.countdown_events
  add constraint countdown_events_operation_id_fkey
    foreign key (operation_id)
    references public.operations (id)
    on delete restrict;

alter table public.operations enable row level security;

create policy operations_select_own on public.operations
  for select using (public.owns_campaign(campaign_id));

-- Operations are append-only and can be created only through record_operation.
-- The function derives created_by from auth.uid() and performs its own owner
-- check because SECURITY DEFINER bypasses RLS.
revoke all on public.operations from anon;
revoke all on public.operations from authenticated;
grant select on public.operations to authenticated;

create function public.record_operation(
  p_campaign_id uuid,
  p_idempotency_key uuid,
  p_operation_type text,
  p_summary text,
  p_metadata jsonb default null,
  p_reverses_operation_id uuid default null
)
returns table (
  operation_id uuid,
  returned_campaign_id uuid,
  returned_idempotency_key uuid,
  returned_operation_type text,
  returned_summary text,
  returned_created_by uuid,
  operation_created_at timestamptz,
  returned_metadata jsonb,
  returned_reverses_operation_id uuid,
  was_applied boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_operation_type text := lower(btrim(p_operation_type));
  v_summary text := btrim(p_summary);
  v_operation public.operations%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_campaign_id is null then
    raise exception using errcode = '22023', message = 'A campaign is required.';
  end if;

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'An idempotency key is required.';
  end if;

  if v_operation_type is null
     or char_length(v_operation_type) not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'Operation type must contain between 1 and 100 characters.';
  end if;

  if v_summary is null or char_length(v_summary) not between 1 and 200 then
    raise exception using
      errcode = '22023',
      message = 'Operation summary must contain between 1 and 200 characters.';
  end if;

  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'Operation metadata must be a JSON object.';
  end if;

  -- Lock the owned campaign before checking its request key. This serializes
  -- concurrent retries in that campaign; the unique constraint remains the
  -- final database-level duplicate guard.
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

  select operation.*
  into v_operation
  from public.operations as operation
  where operation.campaign_id = p_campaign_id
    and operation.idempotency_key = p_idempotency_key;

  if found then
    if v_operation.operation_type <> v_operation_type
       or v_operation.summary <> v_summary
       or v_operation.metadata is distinct from p_metadata
       or v_operation.reverses_operation_id is distinct from p_reverses_operation_id then
      raise exception using
        errcode = '22023',
        message = 'Idempotency key was already used for a different operation.';
    end if;

    return query
      select
        v_operation.id,
        v_operation.campaign_id,
        v_operation.idempotency_key,
        v_operation.operation_type,
        v_operation.summary,
        v_operation.created_by,
        v_operation.created_at,
        v_operation.metadata,
        v_operation.reverses_operation_id,
        false;
    return;
  end if;

  if p_reverses_operation_id is not null
     and not exists (
       select 1
       from public.operations as original
       where original.id = p_reverses_operation_id
         and original.campaign_id = p_campaign_id
     ) then
    raise exception using
      errcode = '22023',
      message = 'The referenced original operation does not belong to this campaign.';
  end if;

  insert into public.operations (
    campaign_id,
    idempotency_key,
    operation_type,
    summary,
    created_by,
    metadata,
    reverses_operation_id
  )
  values (
    p_campaign_id,
    p_idempotency_key,
    v_operation_type,
    v_summary,
    v_user_id,
    p_metadata,
    p_reverses_operation_id
  )
  returning * into v_operation;

  return query
    select
      v_operation.id,
      v_operation.campaign_id,
      v_operation.idempotency_key,
      v_operation.operation_type,
      v_operation.summary,
      v_operation.created_by,
      v_operation.created_at,
      v_operation.metadata,
      v_operation.reverses_operation_id,
      true;
end;
$$;

revoke all on function public.record_operation(
  uuid, uuid, text, text, jsonb, uuid
) from public;
revoke all on function public.record_operation(
  uuid, uuid, text, text, jsonb, uuid
) from anon;
grant execute on function public.record_operation(
  uuid, uuid, text, text, jsonb, uuid
) to authenticated;
