-- Local development seed data.
--
-- Runs only on local `supabase db reset` (and `supabase db seed`). It is NEVER
-- executed against production, so the local-only Game Master login below is not
-- a production credential. Production users are still created manually in
-- Supabase (see OQ-PROD-001). The seed is idempotent and safe to re-run.

do $$
declare
  -- Local-only Game Master login. Not a secret; local Supabase only.
  gm_email text := 'petar.tosevski99@gmail.com';
  gm_password text := 'arijana';
  gm_id uuid;
  demo_campaign uuid;
  blank_template uuid;
  class_record record;
  class_template uuid;
begin
  -- 1. Ensure the local GM auth user exists so a reset never loses the login.
  select id into gm_id from auth.users where email = gm_email;

  if gm_id is null then
    gm_id := gen_random_uuid();

    -- Empty strings (not NULL) for token columns keep older GoTrue happy.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', gm_id, 'authenticated',
      'authenticated', gm_email,
      extensions.crypt(gm_password, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      '', '', '', ''
    );

    -- Password sign-in in current GoTrue requires a matching email identity.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), gm_id, gm_id::text,
      jsonb_build_object('sub', gm_id::text, 'email', gm_email,
                         'email_verified', true),
      'email', now(), now(), now()
    );

    raise notice 'Seeded local GM user %', gm_email;
  else
    raise notice 'GM user already present; leaving credentials untouched.';
  end if;

  -- 2. Demo campaign owned by the GM (idempotent).
  select id into demo_campaign
  from public.campaigns
  where owner_id = gm_id and name = 'Witherwild Demo Campaign'
  limit 1;

  if demo_campaign is not null then
    raise notice 'Demo campaign already present; skipping demo data.';
    return;
  end if;

  insert into public.campaigns (owner_id, name, description)
  values (gm_id, 'Witherwild Demo Campaign',
          'Local development sample campaign.')
  returning id into demo_campaign;

  -- campaign_state is created automatically by trigger.

  -- A single blank template is always available as the builder's fallback.
  insert into public.sheet_templates
    (campaign_id, name, is_blank_template, status)
  values (demo_campaign, 'Blank sheet', true, 'active')
  returning id into blank_template;

  -- A small set of classes, each with its own default sheet template. The
  -- guided builder suggests the class default and falls back to the blank
  -- template when a class has none.
  for class_record in
    select *
    from (values
      ('Guardian', 'A stalwart protector who shields allies from harm.'),
      ('Ranger', 'A wilderness hunter attuned to the Witherwild.'),
      ('Sorcerer', 'A wielder of raw, innate arcane power.'),
      ('Druid', 'A shapeshifting keeper of the natural balance.')
    ) as c(name, description)
  loop
    insert into public.character_classes
      (campaign_id, name, description, is_active)
    values
      (demo_campaign, class_record.name, class_record.description, true);

    insert into public.sheet_templates
      (campaign_id, name, class_id, status)
    values (
      demo_campaign,
      class_record.name || ' sheet',
      (select id from public.character_classes
       where campaign_id = demo_campaign and name = class_record.name),
      'active'
    )
    returning id into class_template;

    update public.character_classes
    set default_template_id = class_template
    where campaign_id = demo_campaign and name = class_record.name;
  end loop;

  -- Legacy roster characters predate the guided builder and intentionally keep
  -- their existing shape (no class/template link).
  insert into public.characters (campaign_id, name, level)
  values
    (demo_campaign, 'Kodak', 1),
    (demo_campaign, 'Korrin', 1),
    (demo_campaign, 'Zane', 1),
    (demo_campaign, 'Mussandra', 1),
    (demo_campaign, 'Nameless One', 1);
end;
$$;
