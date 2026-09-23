-- ============================================================================
-- 0014_subscription.sql
-- Single-business monthly software subscription / license system (₱900/mo).
-- Single tenant, NOT multi-client SaaS. Server-side enforcement via RLS +
-- GRANTs + triggers; the frontend only displays status, never decides it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Core subscription tables
-- ----------------------------------------------------------------------------
create table if not exists public.business_subscription (
  id boolean primary key default true check (id),
  status text not null default 'pending'
    check (status in ('active', 'expired', 'pending', 'suspended', 'cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('paid', 'unpaid', 'pending', 'failed', 'refunded')),
  start_date timestamptz,
  expires_at timestamptz,
  last_payment_at timestamptz,
  last_amount numeric check (last_amount is null or last_amount >= 0),
  grace_days integer not null default 0 check (grace_days >= 0),
  monthly_fee numeric not null default 900 check (monthly_fee >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  amount numeric not null check (amount >= 0),
  method text not null default 'manual',
  reference text,
  status text not null default 'paid'
    check (status in ('paid', 'pending', 'failed', 'refunded')),
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.subscription_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  old_status text,
  new_status text,
  detail text,
  created_at timestamptz not null default now()
);

-- Seed the single license row: first 30-day period starts now (provider
-- activates on install / first ₱900 payment). Idempotent.
insert into public.business_subscription
  (id, status, payment_status, start_date, expires_at, last_payment_at, last_amount, grace_days, monthly_fee)
values
  (true, 'active', 'paid', now(), now() + interval '30 days', now(), 900, 0, 900)
on conflict (id) do nothing;

insert into public.subscription_payments (amount, method, reference, status, period_start, period_end, paid_at)
select 900, 'initial', 'initial-activation', 'paid', s.start_date, s.expires_at, coalesce(s.last_payment_at, now())
from public.business_subscription s
where s.id = true
  and not exists (select 1 from public.subscription_payments);

-- ----------------------------------------------------------------------------
-- 2) RLS: read-only for the client. No insert/update/delete policies for
--    anon/authenticated, plus GRANT revokes, so the client can NEVER change
--    payment_status, expires_at, or status via app, API, or SQL editor.
--    NOTE: anti-tamper/write-guard triggers are created AFTER the seed
--    inserts below, so the initial license row can be written once.
-- ----------------------------------------------------------------------------
alter table public.business_subscription enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.subscription_events enable row level security;

drop policy if exists "subscription_select_admin" on public.business_subscription;
create policy "subscription_select_admin"
  on public.business_subscription for select
  using (public.is_admin());

drop policy if exists "subscription_payments_select_admin" on public.subscription_payments;
create policy "subscription_payments_select_admin"
  on public.subscription_payments for select
  using (public.is_admin());

drop policy if exists "subscription_events_select_admin" on public.subscription_events;
create policy "subscription_events_select_admin"
  on public.subscription_events for select
  using (public.is_admin());

revoke all on public.business_subscription from anon, authenticated;
grant select on public.business_subscription to authenticated;
revoke all on public.subscription_payments from anon, authenticated;
grant select on public.subscription_payments to authenticated;
revoke all on public.subscription_events from anon, authenticated;
grant select on public.subscription_events to authenticated;

-- ----------------------------------------------------------------------------
-- 3) Server-side license check (single source of truth).
--    Active <=> status='active' AND payment_status='paid' AND
--    expires_at + grace_days is still in the future.
--    Computed from the ROW + server clock now() — never browser data.
-- ----------------------------------------------------------------------------
create or replace function public.subscription_is_active()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.business_subscription s
    where s.id = true
      and s.status = 'active'
      and s.payment_status = 'paid'
      and s.expires_at is not null
      and s.expires_at + make_interval(days => coalesce(s.grace_days, 0)) > now()
  );
$$;

-- NOTE: Supabase's default privileges also grant EXECUTE on new functions to
-- anon/authenticated explicitly, so every provider-only function below is
-- revoked from public *and* anon/authenticated (revoking from public alone is
-- not enough there).
revoke all on function public.subscription_is_active() from public, anon, authenticated;
grant execute on function public.subscription_is_active() to authenticated, service_role;

-- Read-only snapshot for Admin > Subscription. No secrets, just license row.
create or replace function public.subscription_status()
returns table (
  status text,
  payment_status text,
  start_date timestamptz,
  expires_at timestamptz,
  last_payment_at timestamptz,
  last_amount numeric,
  grace_days integer,
  monthly_fee numeric,
  is_active boolean,
  days_remaining integer,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.status,
    s.payment_status,
    s.start_date,
    s.expires_at,
    s.last_payment_at,
    s.last_amount,
    s.grace_days,
    s.monthly_fee,
    (
      s.status = 'active'
      and s.payment_status = 'paid'
      and s.expires_at is not null
      and s.expires_at + make_interval(days => coalesce(s.grace_days, 0)) > now()
    ) as is_active,
    case
      when s.expires_at is null then null
      else greatest(0, ceil(extract(epoch from (s.expires_at - now())) / 86400.0)::integer)
    end as days_remaining,
    s.updated_at
  from public.business_subscription s
  where s.id = true
    -- Defense in depth: only admins (and the service-role provider) can read
    -- the license snapshot. Customers never see fee/expiry details.
    and (public.is_admin() or auth.uid() is null);
$$;

revoke all on function public.subscription_status() from public, anon, authenticated;
grant execute on function public.subscription_status() to authenticated, service_role;

-- Flips a lapsed 'active' row to 'expired' + audit log. Called on every
-- admin status read (and by the write-guard) so expiry is recorded
-- server-side even with no cron job.
create or replace function public.refresh_subscription_status()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.business_subscription%rowtype;
begin
  -- Defense in depth: only admins (or the service-role provider / internal
  -- guards) may trigger the expiry sweep. A customer session gets a no-op.
  if auth.uid() is not null and not public.is_admin() then
    return;
  end if;
  -- Writes below go through the anti-tamper trigger, so raise the internal
  -- flag first (same as the provider renewal function does).
  perform set_config('app.subscription_internal', 'on', true);
  select * into r from public.business_subscription where id = true;
  if not found then
    return;
  end if;
  if r.status = 'active'
     and (
       r.expires_at is null
       or r.payment_status <> 'paid'
       or r.expires_at + make_interval(days => coalesce(r.grace_days, 0)) <= now()
     ) then
    update public.business_subscription
       set status = 'expired', updated_at = now()
     where id = true;
    insert into public.subscription_events (event_type, old_status, new_status, detail)
    values ('expired', r.status, 'expired',
            'License lapsed at ' || coalesce(r.expires_at::text, 'unknown') || '; marked expired by refresh_subscription_status.');
  end if;
end;
$$;

revoke all on function public.refresh_subscription_status() from public, anon, authenticated;
grant execute on function public.refresh_subscription_status() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4) Anti-tamper trigger: direct writes to license tables are rejected.
--    Only the provider renewal function (session flag below) may modify them.
-- Renewals land on business_subscription + subscription_payments +
-- subscription_events via subscription_record_payment() only (service_role).
-- That function raises app.subscription_internal so the anti-tamper trigger
-- lets its writes through; any other session gets SUBSCRIPTION_READ_ONLY.
-- ----------------------------------------------------------------------------
create or replace function public.prevent_subscription_tamper()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only our own SECURITY DEFINER routines (running as the table owner after
  -- raising the internal flag) may write. A direct client statement — even with
  -- the internal flag forced on — is rejected because its effective role is a
  -- client role, not the owner.
  if coalesce(current_setting('app.subscription_internal', true), '') = 'on'
     and current_user not in ('anon', 'authenticated') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'SUBSCRIPTION_READ_ONLY: license rows can only be changed by the provider renewal function.';
end;
$$;

-- Trigger-only helper: revoke direct execution from every client role.
revoke all on function public.prevent_subscription_tamper() from public, anon, authenticated;

drop trigger if exists business_subscription_no_direct_write on public.business_subscription;
create trigger business_subscription_no_direct_write
  before insert or update or delete on public.business_subscription
  for each row execute function public.prevent_subscription_tamper();

drop trigger if exists subscription_payments_no_direct_write on public.subscription_payments;
create trigger subscription_payments_no_direct_write
  before insert or update or delete on public.subscription_payments
  for each row execute function public.prevent_subscription_tamper();

drop trigger if exists subscription_events_no_direct_write on public.subscription_events;
create trigger subscription_events_no_direct_write
  before insert or update or delete on public.subscription_events
  for each row execute function public.prevent_subscription_tamper();

-- ----------------------------------------------------------------------------
-- 5) Provider-only renewal (service_role key — NEVER the anon key).
--    Each successful payment extends the license 30 days from the LATER of
--    now() or the current expires_at (no lost days on early renewal).
--    No grant to anon/authenticated, so the client cannot self-renew or
--    forge payments via crafted API calls.
--    Provider renewal (Supabase dashboard > SQL, service_role):
--      select public.subscription_record_payment(900, 'gcash', 'GCash ref 123');
-- ----------------------------------------------------------------------------
create or replace function public.subscription_record_payment(
  p_amount numeric,
  p_method text default 'manual',
  p_reference text default null
)
returns table (new_expires_at timestamptz, new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.business_subscription%rowtype;
  base timestamptz;
  new_exp timestamptz;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'Invalid payment amount.';
  end if;
  perform set_config('app.subscription_internal', 'on', true);
  select * into r from public.business_subscription where id = true for update;
  if not found then
    raise exception 'Business subscription row is missing.';
  end if;
  if p_amount < coalesce(r.monthly_fee, 900) then
    raise exception 'Payment below the monthly fee of % is not accepted.', coalesce(r.monthly_fee, 900);
  end if;
  base := greatest(coalesce(r.expires_at, now()), now());
  new_exp := base + interval '30 days';
  update public.business_subscription
     set status = 'active',
         payment_status = 'paid',
         start_date = coalesce(start_date, now()),
         expires_at = new_exp,
         last_payment_at = now(),
         last_amount = p_amount,
         updated_at = now()
   where id = true;
  insert into public.subscription_payments (amount, method, reference, status, period_start, period_end, paid_at)
  values (p_amount, coalesce(nullif(p_method, ''), 'manual'), p_reference, 'paid', base, new_exp, now());
  insert into public.subscription_events (event_type, old_status, new_status, detail)
  values ('renewed', r.status, 'active',
          'Payment of ' || p_amount::text || ' via ' || coalesce(nullif(p_method, ''), 'manual')
          || coalesce(' ref ' || p_reference, '') || '; valid until ' || new_exp::text || '.');
  new_expires_at := new_exp;
  new_status := 'active';
  return next;
end;
$$;

revoke all on function public.subscription_record_payment(numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.subscription_record_payment(numeric, text, text) to service_role;

-- Provider-only settings: adjustable backend grace period + monthly fee.
-- (Direct UPDATEs stay blocked by the anti-tamper trigger, so the provider
-- uses this instead. No grant to anon/authenticated.)
--   select public.subscription_update_settings(3, 900);  -- 3-day grace
create or replace function public.subscription_update_settings(
  p_grace_days integer default null,
  p_monthly_fee numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.subscription_internal', 'on', true);
  update public.business_subscription
     set grace_days = coalesce(p_grace_days, grace_days),
         monthly_fee = coalesce(p_monthly_fee, monthly_fee),
         updated_at = now()
   where id = true;
end;
$$;

revoke all on function public.subscription_update_settings(integer, numeric)
  from public, anon, authenticated;
grant execute on function public.subscription_update_settings(integer, numeric) to service_role;

-- ----------------------------------------------------------------------------
-- 6) Business write-guard: blocks ALL booking/payment/court/paddle/settings
--    writes while the license is expired. Reads keep working (records stay
--    viewable). Error prefix SUBSCRIPTION_EXPIRED lets the frontend map it
--    to the Renewal page. Runs BEFORE insert/update/delete so no expired
--    write slips through, regardless of RLS role or crafted requests.
-- ----------------------------------------------------------------------------
create or replace function public.assert_subscription_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.refresh_subscription_status();
  exception when others then
    null;
  end;
  if not public.subscription_is_active() then
    raise exception 'SUBSCRIPTION_EXPIRED: The software license has expired. Renew the ₱900 monthly subscription to resume booking management.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Trigger-only helper: revoke direct execution from every client role.
revoke all on function public.assert_subscription_active() from public, anon, authenticated;

drop trigger if exists bookings_require_subscription on public.bookings;
create trigger bookings_require_subscription
  before insert or update or delete on public.bookings
  for each row execute function public.assert_subscription_active();

drop trigger if exists payments_require_subscription on public.payments;
create trigger payments_require_subscription
  before insert or update or delete on public.payments
  for each row execute function public.assert_subscription_active();

drop trigger if exists courts_require_subscription on public.courts;
create trigger courts_require_subscription
  before insert or update or delete on public.courts
  for each row execute function public.assert_subscription_active();

drop trigger if exists paddles_require_subscription on public.paddles;
create trigger paddles_require_subscription
  before insert or update or delete on public.paddles
  for each row execute function public.assert_subscription_active();

drop trigger if exists facility_settings_require_subscription on public.facility_settings;
create trigger facility_settings_require_subscription
  before insert or update or delete on public.facility_settings
  for each row execute function public.assert_subscription_active();





