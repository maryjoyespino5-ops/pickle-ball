-- ============================================================================
-- 0008_seed_admin.sql
-- Seeds the admin-panel account so it can log in at /login and reach /admin.
--
-- !!! SECURITY (C1) — NO CREDENTIALS ARE COMMITTED HERE !!!
--   Earlier revisions of this file hard-coded a working admin email + password.
--   Those credentials are considered COMPROMISED and have been removed:
--     1) If this migration already ran anywhere, ROTATE the password NOW via
--        Supabase Dashboard > Authentication > Users > 'Reset password', or
--        Admin Workspace > Settings > Change password. Assume the old password
--        is public to anyone who ever had repo access.
--     2) This file no longer creates a default password. To bootstrap the first
--        admin, either:
--          a) create the user interactively in the Supabase Dashboard (Auth),
--             then promote it below by setting admin_email to that address, or
--          b) run the dashboard SQL below with YOUR OWN strong password:
--               update auth.users
--                  set encrypted_password =
--                    extensions.crypt('<your-strong-password>',
--                                     extensions.gen_salt('bf'))
--                where lower(email) = '<your-admin-email>';
--     3) The admin email below is a PLACEHOLDER only. Change it to the real
--        admin address (env/secret), and never commit a real password again.
--
-- Notes:
--   * 0001_profiles.sql auto-creates every new auth user with role 'customer'
--     and its prevent_role_change trigger blocks role updates, so that trigger
--     is briefly disabled here while the role is promoted to 'admin'.
--   * If no auth user exists for ADMIN_EMAIL yet, this migration creates a
--     shell account with a RANDOM, unusable password (must be reset by the
--     operator before first login). It never uses a guessable default.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  admin_uuid  uuid := 'a51ca1ad-0000-4000-8000-000000000001';
  -- PLACEHOLDER admin login. Replace with the real admin address (kept out of
  -- source control). The account gets a RANDOM, unusable password and MUST be
  -- reset by the operator before first login — see the header.
  admin_email text := 'alicarayad@admin.com';
  admin_name  text := 'Alicayard Admin';
  v_user_id   uuid;
  v_random_pw text;
begin
  -- A random, non-guessable placeholder password. It is NEVER printed or
  -- recoverable; the operator must reset the password before this account can
  -- sign in. This removes any committed/known credential.
  v_random_pw := encode(extensions.gen_random_bytes(24), 'hex');
  -- Resolve the admin account first: the project may already have this email
  -- under a DIFFERENT id (e.g. created via a normal signup or an earlier seed),
  -- in which case admin_uuid is wrong and pinning it would collide with the
  -- existing auth.identities row on (provider_id, provider).
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = admin_email
  limit 1;

  -- ---------------------------------------------------------------------------
  -- 1) Auth user + email identity (skipped if the email already exists)
  -- ---------------------------------------------------------------------------
  if v_user_id is null then
    insert into auth.users (
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new
    ) values (
      admin_uuid,
      'authenticated',
      'authenticated',
      admin_email,
      extensions.crypt(v_random_pw, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Alicayard Admin"}',
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
    v_user_id := admin_uuid;
  end if;

  -- Email identity so the account behaves like a normal signup.
  -- Supabase stores an email identity as provider='email' with
  -- provider_id = <user id>, and the uniqueness is on (provider_id, provider).
  -- The account may already have one, and the admin email may already exist
  -- under a DIFFERENT user id, so both are checked before inserting.
  --
  -- auth.identities.id has been BOTH uuid and text across Supabase versions, so
  -- build the row with a parameter typed from the column itself rather than
  -- hard-coding a cast that only suits one schema version.
  if not exists (
    select 1
    from auth.identities i
    where i.provider = 'email'
      and (
        i.provider_id = v_user_id::text
        or i.user_id = v_user_id
        or coalesce(i.identity_data ->> 'email', '') = admin_email
      )
  ) then
    execute format(
      $fmt$
        insert into auth.identities (
          id, user_id, provider_id, provider, identity_data,
          last_sign_in_at, created_at, updated_at
        ) values ($1::%1$s, $2, $2::text, 'email', $3, now(), now(), now())
      $fmt$,
      (select format_type(a.atttypid, a.atttypmod)
         from pg_attribute a
        where a.attrelid = 'auth.identities'::regclass
          and a.attname = 'id'
          and not a.attisdropped)
    )
    using
      v_user_id::text,
      v_user_id,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', admin_email,
        'email_verified', true
      );
  end if;

  -- ---------------------------------------------------------------------------
  -- 2) Promote the profile to 'admin'
  --    (handle_new_user created it as 'customer'; prevent_role_change blocks
  --     role updates, so the trigger is disabled just for this promotion)
  -- ---------------------------------------------------------------------------
  alter table public.profiles disable trigger profiles_prevent_role_change;

  update public.profiles
     set role = 'admin'
   where id = v_user_id;

  -- Do not rely on FOUND here: earlier statements in this block (the identity
  -- guard / insert) reset it. Check the row exists outright, and make the
  -- fallback conflict-safe on the primary key.
  if not exists (
    select 1 from public.profiles p where p.id = v_user_id
  ) then
    -- Fallback: profile row missing (e.g. trigger was absent) — insert directly.
    -- Inserts are not blocked by prevent_role_change (it only guards updates).
    insert into public.profiles (id, full_name, email, role)
    values (v_user_id, admin_name, admin_email, 'admin')
    on conflict (id) do nothing;
  end if;

  alter table public.profiles enable trigger profiles_prevent_role_change;

  raise notice 'Admin profile ready for %. NO default password is set: reset it in Supabase Dashboard > Authentication > Users (or run an encrypted_password UPDATE with your own strong password) before first login.', admin_email;
end
$$;