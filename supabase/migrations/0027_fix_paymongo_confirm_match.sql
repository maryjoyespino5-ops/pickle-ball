-- ============================================================================
-- 0027_fix_paymongo_confirm_match.sql
--
-- confirm_booking_from_paymongo (0021) matched a PayMongo event to a payment
-- row with this WHERE clause:
--
--     where (p_session_ref is not null
--             and p.paymongo_checkout_session_id = p_session_ref)
--        or (p.payment_id is not null
--             and p.paymongo_payment_id = p.payment_id)
--
-- `payments.payment_id` does not exist — the intent was the FUNCTION PARAMETER
-- p_payment_ref (the pay_... id PayMongo reports), exactly as the duplicate
-- branch a few lines above already does:
--
--        or (p_payment_ref is not null
--             and p.paymongo_payment_id = p_payment_ref)
--
-- Because this is static SQL inside plpgsql, the whole function raises
--
--     42703: column p.payment_id does not exist
--
-- the first time that statement runs — for EVERY caller:
--
--   * supabase/functions/paymongo-webhook → the GCash webhook could never
--     confirm a booking payment: money collected, booking still pending/unpaid,
--     and the player's status poll timed out.
--   * public.reconcile_booking_payment (0022) → the admin "Recover from
--     PayMongo" action on the Payments page failed with HTTP 400 the moment it
--     was clicked.
--
-- This migration only replaces the function body with the corrected reference.
-- The idempotency ledger, the amount cross-check, the internal flags, the
-- 'pending' -> 'confirmed' transition (0024) and the refusal to resurrect a
-- cancelled booking are all unchanged.
--
-- The self-check at the end CALLS the function (with a marker event id and no
-- PayMongo refs), so the statement is really parsed and executed by Postgres
-- and the migration fails instead of shipping a broken body again. The marker
-- row it writes to the idempotency ledger is removed afterwards.
-- ============================================================================


create or replace function public.confirm_booking_from_paymongo(
  p_event_id text,
  p_session_ref text default null,
  p_payment_ref text default null,
  p_amount numeric default null,
  p_method text default 'GCash',
  p_event_type text default 'payment.paid'
)
returns table (
  outcome text,          -- 'confirmed' | 'duplicate' | 'not_found' | 'amount_mismatch'
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
  v_inserted integer := 0;
  v_payment public.payments%rowtype;
  v_booking public.bookings%rowtype;
  v_ref text;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'Missing PayMongo event id.';
  end if;

  -- (a) Idempotency, shared with the license flow: the SAME
  -- payment_webhook_events table means one delivery is processed once, whether
  -- it is a license renewal or a booking payment. ON CONFLICT DO NOTHING
  -- returns 0 rows when the event was already handled.
  insert into public.payment_webhook_events
    (event_id, provider, event_type, paymongo_payment_id, paymongo_link_reference,
     amount, status, detail)
  values
    (p_event_id, 'paymongo', p_event_type, p_payment_ref, p_session_ref,
     p_amount, 'processed', 'booking payment')
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    -- Already handled. Report the current state of the matched booking without
    -- touching it, so a replayed delivery can never re-confirm anything.
    return query
      select 'duplicate'::text, b.booking_number, b.status, b.payment_status,
             p.amount
      from public.payments p
      join public.bookings b on b.id = p.booking_id
      where (p_session_ref is not null
              and p.paymongo_checkout_session_id = p_session_ref)
         or (p_payment_ref is not null
              and p.paymongo_payment_id = p_payment_ref)
      limit 1;
    return;
  end if;

  -- (b) Match the booking: by checkout session first (the id we created), then
  -- by payment id (covers a webhook that arrives before we stored the session).
  -- THE FIX: the second branch compares against the p_payment_ref PARAMETER.
  -- (0021 wrote `p.payment_id`, a column that does not exist, which raised
  -- 42703 for the webhook and for the admin recovery action alike.)
  select * into v_payment
  from public.payments p
  where (p_session_ref is not null
          and p.paymongo_checkout_session_id = p_session_ref)
     or (p_payment_ref is not null
          and p.paymongo_payment_id = p_payment_ref)
  order by (p.paymongo_checkout_session_id = p_session_ref) desc nulls last
  limit 1
  for update;

  if not found then
    -- Unknown/foreign payment (e.g. a license link payment routed here). The
    -- event is already claimed above, so it is never retried into a booking.
    return query select 'not_found'::text, null::text, null::text, null::text,
                        null::numeric;
    return;
  end if;

  select * into v_booking from public.bookings where id = v_payment.booking_id;

  if v_booking.id is null then
    return query select 'not_found'::text, null::text, null::text, null::text,
                        null::numeric;
    return;
  end if;

  -- A cancelled booking must not be resurrected by a late payment. Report it as
  -- duplicate-style no-op and leave the money question to the facility.
  if v_booking.status = 'cancelled' then
    return query select 'duplicate'::text, v_booking.booking_number,
                        v_booking.status, v_booking.payment_status, v_payment.amount;
    return;
  end if;

  -- (c) Amount cross-check. p_amount is what PayMongo says it collected. If it
  -- is present and does not cover the booking, refuse to confirm — this is the
  -- guard against a tampered/partial payment. A null amount (some event shapes)
  -- falls through to the session-verified path.
  if p_amount is not null and p_amount > 0
     and round(p_amount, 2) < round(v_booking.amount, 2) then
    return query select 'amount_mismatch'::text, v_booking.booking_number,
                        v_booking.status, v_booking.payment_status, p_amount;
    return;
  end if;

  v_ref := coalesce(nullif(p_payment_ref, ''), nullif(p_session_ref, ''), p_event_id);

  -- Raise the internal flags BEFORE the writes: the same transaction that marks
  -- the payment paid also confirms the booking, and the customer-facing guards
  -- must let the server's own update through.
  perform set_config('app.internal_payment_sync', 'on', true);
  perform set_config('app.booking_server_confirm', 'on', true);

  -- (d) Payment row: paid + the PayMongo transaction reference. The 0019 trigger
  --     mirrors status onto bookings.payment_status in this transaction.
  update public.payments
     set status = 'paid',
         method = coalesce(nullif(p_method, ''), 'GCash'),
         reference = v_ref,
         paid_at = now(),
         paymongo_payment_id = coalesce(nullif(p_payment_ref, ''), paymongo_payment_id),
         paymongo_checkout_session_id =
           coalesce(nullif(p_session_ref, ''), paymongo_checkout_session_id),
         paymongo_reference = v_ref,
         paymongo_amount = coalesce(p_amount, paymongo_amount),
         paymongo_paid_at = now()
   where id = v_payment.id;

  -- (e) Booking status: confirmed. (d) already set payment_status='paid', and
  --     the two happen together, so "paid but still pending" cannot occur.
  update public.bookings
     set status = 'confirmed',
         updated_at = now()
   where id = v_booking.id;

  perform set_config('app.booking_server_confirm', 'off', true);
  perform set_config('app.internal_payment_sync', 'off', true);

  return query
    select 'confirmed'::text, b.booking_number, b.status, b.payment_status, p.amount
    from public.bookings b
    join public.payments p on p.booking_id = b.id
    where b.id = v_booking.id;
end;
$$;

comment on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text) is
  'Service-role-only entry point for the PayMongo webhook — and for the admin "Recover from PayMongo" action, which reuses it. Idempotent on the PayMongo event id; atomically sets payments.status=paid (mirrored to bookings.payment_status) and bookings.status=confirmed, and stores the PayMongo transaction reference against the booking.';

revoke all on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text)
  to service_role;


-- ----------------------------------------------------------------------------
-- Self-check: RUN the function with no PayMongo references, so the match
-- statement — the one the typo broke — is really parsed and executed by
-- Postgres. A NULL session/payment ref can never match a real payment row, so
-- this reaches only the idempotency ledger, and the marker row is removed
-- immediately afterwards. If the body is ever broken again, the push fails
-- here instead of silently killing the GCash confirmation path.
-- ----------------------------------------------------------------------------
do $$
declare
  v_outcome text;
begin
  select outcome into v_outcome
  from public.confirm_booking_from_paymongo(
    '__0027_selfcheck__',   -- p_event_id (marker row, removed below)
    null,                   -- p_session_ref
    null,                   -- p_payment_ref
    null,                   -- p_amount
    'GCash',
    'selfcheck'
  );

  if v_outcome is distinct from 'not_found' then
    raise exception '0027: self-check returned an unexpected outcome (%).', v_outcome;
  end if;

  delete from public.payment_webhook_events
   where event_id = '__0027_selfcheck__';

  raise notice '0027: verified — confirm_booking_from_paymongo parses and runs (outcome=%).', v_outcome;
end;
$$;
