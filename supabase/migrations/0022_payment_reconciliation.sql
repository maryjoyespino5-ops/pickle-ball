-- ============================================================================
-- 0022_payment_reconciliation.sql
--
-- Repairs the drift caused by the webhook routing bug: a paid PayMongo
-- transaction whose event was misrouted into the LICENSE flow left
--     payments.status       = 'pending'    (should be 'paid')
--     bookings.payment_status = 'pending'
--     bookings.status         = 'upcoming'
-- while PayMongo really did collect the money.
--
-- Two additions, both additive and safe to re-run:
--
--   1. reconcile_booking_payment(...) — service_role / admin entry point that
--      marks ONE booking paid from its verified PayMongo identifiers and
--      confirms it, reusing the SAME atomic path as the live webhook
--      (confirm_booking_from_paymongo). Nothing new can be trusted here: the
--      amount is still cross-checked against the booking before confirming.
--
--   2. find_stuck_booking_payments() — admin-only helper that lists bookings
--      which still look unpaid but carry a PayMongo checkout session id, i.e.
--      the candidates a reconciliation pass should look at.
--
-- The live webhook fix (routing on reference_number + stored session id) is in
-- supabase/functions/paymongo-webhook/index.ts; this migration only cleans up
-- what the bug already left behind.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Admin helper: which bookings look stuck?
--    A stuck booking has a PayMongo session attached (so a checkout WAS
--    started) but is still not marked paid. Cancelled rows are excluded —
--    a cancelled booking is intentionally never confirmed.
-- ----------------------------------------------------------------------------
create or replace function public.find_stuck_booking_payments(
  p_since timestamptz default null
)
returns table (
  booking_number text,
  booking_status text,
  payment_status text,
  amount numeric,
  paymongo_checkout_session_id text,
  paymongo_reference text,
  booking_date date,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.booking_number,
    b.status,
    b.payment_status,
    b.amount,
    p.paymongo_checkout_session_id,
    p.paymongo_reference,
    b.booking_date,
    b.created_at
  from public.bookings b
  join public.payments p on p.booking_id = b.id
  where b.deleted_at is null
    and b.status <> 'cancelled'
    and b.payment_status <> 'paid'
    and p.status <> 'paid'
    -- Only bookings that actually reached PayMongo are candidates.
    and p.paymongo_checkout_session_id is not null
    and (p_since is null or b.created_at >= p_since)
  order by b.created_at desc;
$$;

comment on function public.find_stuck_booking_payments(timestamptz) is
  'Admin-only: lists bookings that started a PayMongo checkout but are still marked unpaid — the audit list for reconciling payments the webhook failed to confirm.';

revoke all on function public.find_stuck_booking_payments(timestamptz)
  from public, anon, authenticated;
grant execute on function public.find_stuck_booking_payments(timestamptz)
  to service_role, authenticated;


-- ----------------------------------------------------------------------------
-- 2) Reconcile ONE booking from verified PayMongo identifiers.
--
--    This is deliberately a thin wrapper over confirm_booking_from_paymongo(),
--    so a reconciliation commit goes through exactly the same amount
--    cross-check, idempotency ledger and trigger flags as a live webhook:
--      * the amount is still verified against the booking row,
--      * payments.status='paid' and bookings.status='confirmed' still commit
--        in one transaction,
--      * a replay of the same event id is still a no-op.
--
--    The caller supplies the identifiers PayMongo gave THEM (dashboard or API);
--    the database trusts them only as much as the webhook does, because the
--    amount must still cover the booking.
-- ----------------------------------------------------------------------------
create or replace function public.reconcile_booking_payment(
  p_booking_number text,
  p_event_id text default null,
  p_session_ref text default null,
  p_payment_ref text default null,
  p_amount numeric default null,
  p_method text default 'GCash'
)
returns table (
  outcome text,
  booking_number text,
  booking_status text,
  payment_status text,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_payment public.payments%rowtype;
  v_event_id text;
  v_amount numeric;
begin
  -- Only an admin (or the service_role used by an Edge Function / operator
  -- script) may reconcile money. Authenticated non-admins are refused.
  if not (public.is_admin() or auth.role() = 'service_role') then
    raise exception 'Only an administrator can reconcile a booking payment.';
  end if;

  select * into v_booking
  from public.bookings b
  where b.booking_number = btrim(coalesce(p_booking_number, ''))
    and b.deleted_at is null;

  if v_booking.id is null then
    raise exception 'Booking was not found.';
  end if;

  select * into v_payment from public.payments p where p.booking_id = v_booking.id;
  if v_payment.id is null then
    raise exception 'This booking has no payment row to reconcile.';
  end if;

  -- Already settled: report the current state instead of writing anything.
  if v_payment.status = 'paid' and v_booking.payment_status = 'paid' then
    return query
      select 'duplicate'::text, v_booking.booking_number, v_booking.status,
             v_booking.payment_status, v_payment.amount;
    return;
  end if;

  -- Prefer the identifiers already stored against the payment row, so an
  -- operator only has to supply the booking number in the common case.
  p_session_ref := coalesce(nullif(p_session_ref, ''), v_payment.paymongo_checkout_session_id);
  p_payment_ref := coalesce(nullif(p_payment_ref, ''), v_payment.paymongo_payment_id);

  -- The reconciliation must still be traceable: synthesise a deterministic
  -- event id when the caller has none, so the shared idempotency ledger keeps
  -- a reconciliation from being applied twice.
  v_event_id := coalesce(
    nullif(p_event_id, ''),
    'reconcile:' || v_booking.booking_number || ':' ||
      coalesce(p_payment_ref, p_session_ref, 'manual')
  );

  -- Amount: the caller's figure if given, else the amount the booking already
  -- records (set_booking_amount derived it from courts.price_per_hour).
  v_amount := coalesce(p_amount, v_booking.amount);

  return query
    select * from public.confirm_booking_from_paymongo(
      v_event_id,
      p_session_ref,
      p_payment_ref,
      v_amount,
      coalesce(nullif(p_method, ''), 'GCash'),
      'reconciliation.paid'
    );
end;
$$;

comment on function public.reconcile_booking_payment(text, text, text, text, numeric, text) is
  'Admin/service_role only: marks a booking paid+confirmed from verified PayMongo identifiers, reusing the same atomic, amount-checked, idempotent path as the live webhook. Used to recover bookings the webhook failed to confirm.';

revoke all on function public.reconcile_booking_payment(text, text, text, text, numeric, text)
  from public, anon;
grant execute on function public.reconcile_booking_payment(text, text, text, text, numeric, text)
  to service_role, authenticated;


-- ----------------------------------------------------------------------------
-- 3) Make the payments audit columns visible to admins.
--    The admin Payments page shows the method/reference; the PayMongo
--    identifiers were added in 0021 but are useful for support ("which session
--    is this booking?"). No policy change is needed — the existing admin
--    SELECT policy on payments already covers every column.
-- ----------------------------------------------------------------------------
comment on column public.payments.paymongo_reference is
  'PayMongo transaction reference stored against the booking (pay_... or cs_...). Shown in the admin Payments/Bookings tables.';