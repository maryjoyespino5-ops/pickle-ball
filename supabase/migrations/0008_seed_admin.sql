-- ============================================================================
-- 0008_seed_admin.sql
-- Seeds the admin-panel account so it can log in at /login and reach /admin.
--
--   email:    alicarayad@admin.com
--   password: 123123123
--
-- Notes:
--   * The password is bcrypt-hashed with pgcrypto (the same scheme GoTrue /
--     Supabase Auth uses), so the account works immediately — no email
--     confirmation needed (email_confirmed_at is set).
--   * The plaintext password lives in this file and is visible to anyone with
--     repo access. It is recommended to change it after the first login
--     (Customer > Profile > password, or a password reset email).
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
begin
  -- ---------------------------------------------------------------------------
  -- 1) Auth user + email identity (skipped if the email already exists)
  -- ---------------------------------------------------------------------------
  if not exists (
    select 1 from auth.users where lower(email) = admin_email
  ) then
    insert into auth.users (
      instance_id,
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
      '00000000-0000-0000-0000-000000000000',
      admin_uuid,
      'authenticated',
      'authenticated',
      admin_email,
      extensions.crypt('123123123', extensions.gen_salt('bf')),
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

    -- Email identity so the account behaves like a normal signup.
    -- (identities.id is a text column on current Supabase projects)
    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      admin_uuid::text,
      admin_uuid,
      'email',
      jsonb_build_object(
        'sub', admin_uuid::text,
        'email', admin_email,
        'email_verified', true
      ),
      now(),
      now(),
      now()
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
   where lower(email) = admin_email;

  if not found then
    -- Fallback: profile row missing (e.g. trigger was absent) — insert directly.
    -- Inserts are not blocked by prevent_role_change (it only guards updates).
    insert into public.profiles (id, full_name, email, role)
    values (admin_uuid, admin_name, admin_email, 'admin');
  end if;

  alter table public.profiles enable trigger profiles_prevent_role_change;
end
$$;