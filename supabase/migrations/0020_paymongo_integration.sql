-- ============================================================================
-- 0020_paymongo_integration.sql
-- Connect the license renewal flow to a PayMongo Payment Link (₱999/month).
--
--   * Aligns the license fee to ₱999 to match the live PayMongo Payment Link
--     (was ₱900). No schema change — monthly_fee is a column, not a constant.
--
--   * Adds `payment_webhook_events` — an idempotency ledger for PayMongo
--     webhooks so a replayed/duplicate delivery can never renew the license
--     twice. Keyed on the PayMongo event id.
--
--   * Adds `subscription_renew_from_paymongo()` — the ONE function the Edge
--     Function calls. It is service_role-only and wraps the EXISTING
--     subscription_record_payment() so all license rules (anti-tamper,
--     30-day extension from the later of now/current expiry, audit trail)
--     stay exactly as they are.
--
-- Additive only. Existing license rules, expiry behaviour and the expired
-- read-only mode are unchanged.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Align the monthly fee to the live PayMongo amount (₱999).
--    Uses the anti-tamper session flag the provider functions already raise.
-- ----------------------------------------------------------------------------
do $$
begin
  perform set_config('app.subscription_internal', 'on', true);
  update public.business_subscription
     set monthly_fee = 999,
         updated_at = now()
   where id = true
     and monthly_fee <> 999;
end $$;


-- ----------------------------------------------------------------------------
-- 2) Idempotency ledger for PayMongo webhooks.
--    One row per processed PayMongo event; a duplicate delivery hits the
--    primary-key conflict and is skipped. Service-role only (no client
--    access), so a customer can never forge or clear an entry.
-- ----------------------------------------------------------------------------
create table if not exists public.payment_webhook_events (
  event_id text primary key,              -- PayMongo event id (evt_...)
  provider text not null default 'paymongo',
  event_type text,
  paymongo_payment_id text,               -- pay_... (the charge/payment)
  paymongo_link_reference text,           -- the link reference (e.g. OqqZPix)
  amount numeric,
  status text not null default 'processed'
    check (status in ('processed', 'ignored', 'failed')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists payment_webhook_events_payment_idx
  on public.payment_webhook_events (paymongo_payment_id);

alter table public.payment_webhook_events enable row level security;

-- Admins may READ the ledger for support/audit; nobody but service_role writes.
drop policy if exists "payment_webhook_events_select_admin" on public.payment_webhook_events;
create policy "payment_webhook_events_select_admin"
  on public.payment_webhook_events for select
  using (public.is_admin());

revoke all on public.payment_webhook_events from anon, authenticated;
grant select on public.payment_webhook_events to authenticated;


-- ----------------------------------------------------------------------------
-- 3) The single renewal entry point the Edge Function calls.
--    - records the PayMongo event in the idempotency ledger FIRST (or returns
--      'duplicate' if it was already processed),
--    - then renews 30 days via the EXISTING subscription_record_payment(),
--      storing the PayMongo reference/payment id in the payment history.
--    - service_role only.
-- ----------------------------------------------------------------------------
create or replace function public.subscription_renew_from_paymongo(
  p_event_id text,
  p_payment_id text,
  p_link_reference text,
  p_amount numeric,
  p_event_type text default 'payment.paid'
)
returns table (outcome text, new_expires_at timestamptz, new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_ref text;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'Missing PayMongo event id.';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Invalid payment amount.';
  end if;

  -- Build the reference stored in the payment history: the PayMongo payment id
  -- plus the link reference, so reports/receipts trace back to PayMongo.
  v_ref := coalesce(nullif(p_payment_id, ''), p_event_id)
           || coalesce(' (' || nullif(p_link_reference, '') || ')', '');

  -- Idempotency: claim the event id. ON CONFLICT DO NOTHING → 0 rows when the
  -- event was already processed, so we never renew twice for one payment.
  insert into public.payment_webhook_events
    (event_id, provider, event_type, paymongo_payment_id, paymongo_link_reference, amount, status)
  values
    (p_event_id, 'paymongo', p_event_type, p_payment_id, p_link_reference, p_amount, 'processed')
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    -- Already handled. Report the current license state without touching it.
    return query
      select 'duplicate'::text, s.expires_at, s.status
      from public.business_subscription s
      where s.id = true;
    return;
  end if;

  -- Renew through the EXISTING provider function — all license rules apply.
  return query
    select 'renewed'::text, r.new_expires_at, r.new_status
    from public.subscription_record_payment(p_amount, 'paymongo', v_ref) r;
end;
$$;

comment on function public.subscription_renew_from_paymongo(text, text, text, numeric, text) is
  'Service-role-only entry point for the PayMongo webhook. Idempotent on the PayMongo event id; renews 30 days via subscription_record_payment().';

revoke all on function public.subscription_renew_from_paymongo(text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.subscription_renew_from_paymongo(text, text, text, numeric, text)
  to service_role;


-- ----------------------------------------------------------------------------
-- 4) Keep the read-only license snapshot fee in sync (it reads monthly_fee,
--    so admin pages now show ₱999 automatically — no code change needed).
-- ----------------------------------------------------------------------------
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
    and (public.is_admin() or auth.uid() is null);
$$;

revoke all on function public.subscription_status() from public, anon, authenticated;
grant execute on function public.subscription_status() to authenticated, service_role;