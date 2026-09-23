-- ============================================================================
-- 0008_seed_admin.sql
-- Seeds the admin-panel account so it can log in at /login and reach /admin.
--
--   email:    alicarayad@admin.com
--   password: EbDzZZGNxm98Jgvd   (bootstrap only — CHANGE AFTER FIRST LOGIN)
--
-- !!! SECURITY (S1 / B27) !!!
--   The bootstrap password is COMMITTED to this repository, so anyone with
--   repo access knows it. Treat it as an emergency-only fallback:
--     1) Log in once, then change the password immediately
--        (Admin Workspace > Settings > Change password).
--     2) If this migration already ran in a database, the seeded account is
--        still on the OLD password '123123123' — rotate it there too:
--          update auth.users
--             set encrypted_password =
--               extensions.crypt('paste-new-strong-password',
--                                extensions.gen_salt('bf'))
--           where lower(email) = 'alicarayad@admin.com';
--     3) Never put a real login credential in a committed migration again
--        (create admins interactively via the Supabase dashboard instead).
--
-- Notes:
--   * The password is bcrypt-hashed with pgcrypto (the same scheme GoTrue /
--     Supabase Auth uses), so the account works immediately — no email
--     confirmation needed (email_confirmed_at is set).
--   * 0001_profiles.sql auto-creates every new auth user with role 'customer'
--     and its prevent_role_change trigger blocks role updates, so that trigger
--     is briefly disabled here while the role is promoted to 'admin'.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  admin_uuid  uuid := 'a51ca1ad-0000-4000-8000-000000000001';
  admin_email text := 'alicarayad@admin.com';
  admin_name  text := 'Alicayard Admin';
  v_user_id   uuid;
begin
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
      extensions.crypt('EbDzZZGNxm98Jgvd', extensions.gen_salt('bf')),
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
end
$$;