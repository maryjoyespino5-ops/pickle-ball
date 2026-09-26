-- ============================================================================
-- 0031_license_amount_guard.sql
--
-- Two SEPARATE products share one PayMongo account and one webhook:
--   * P999/month SOFTWARE LICENSE  -> subscription_renew_from_paymongo()
--   * P300 / P600 COURT BOOKINGS   -> confirm_booking_from_paymongo()
--
-- The Edge Function routes between them, but that routing is a judgement call
-- made from event fields. This migration adds the missing SERVER-SIDE guard so
-- the two can never corrupt each other, even if a routing mistake is made.
--
-- THE BUG
--   subscription_renew_from_paymongo validated only `p_amount >= 0`. A P300 court
--   booking payment that was ever misrouted into the license branch would renew
--   the SOFTWARE LICENSE for a full 30 days - silently giving away a month of
--   the product for the price of one court hour. The only thing standing between
--   the two products was the webhook's routing heuristic.
--
-- THE FIX
--   Reject any renewal whose amount is below business_subscription.monthly_fee
--   (a short payment / misrouted booking payment), and refuse to let a court
--   booking reference ever be recorded as a license payment. The fee is read
--   from the row, so raising monthly_fee later keeps working.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) The guard itself.
--
-- SECURITY DEFINER + service_role only, exactly like the function it replaces.
-- The outcome gains an 'amount_mismatch' verdict, mirroring the booking-side
-- confirm_booking_from_paymongo contract so both products report failures the
-- same way and the webhook surfaces them instead of silently succeeding.
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
  v_fee numeric;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'Missing PayMongo event id.';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Invalid payment amount.';
  end if;

  -- The two products must never be confused. A court booking reference leaking
  -- into this branch means the webhook misrouted a player payment; refuse it
  -- rather than renewing the license for a court booking.
  if p_link_reference is not null and btrim(p_link_reference) ~* '^RB-' then
    return query
      select 'not_a_license_payment'::text, s.expires_at, s.status
      from public.business_subscription s
      where s.id = true;
    return;
  end if;

  -- Amount must actually cover the license fee. Read it from the row (not a
  -- literal 999) so an admin raising the monthly fee keeps working.
  select s.monthly_fee into v_fee
  from public.business_subscription s
  where s.id = true;

  if v_fee is not null and round(p_amount, 2) < round(v_fee, 2) then
    -- Too short to be a license payment: almost certainly a court booking that
    -- was misrouted. Report it; do NOT renew, and do NOT claim the event id, so
    -- a later correct delivery can still be processed.
    return query
      select 'amount_mismatch'::text, s.expires_at, s.status
      from public.business_subscription s
      where s.id = true;
    return;
  end if;

  -- Build the reference stored in the payment history: the PayMongo payment id
  -- plus the link reference, so reports/receipts trace back to PayMongo.
  v_ref := coalesce(nullif(p_payment_id, ''), p_event_id)
           || coalesce(' (' || nullif(p_link_reference, '') || ')', '');

  -- Idempotency: claim the event id. ON CONFLICT DO NOTHING -> 0 rows when the
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

  -- Renew through the EXISTING provider function -- all license rules apply.
  return query
    select 'renewed'::text, r.new_expires_at, r.new_status
    from public.subscription_record_payment(p_amount, 'paymongo', v_ref) r;
end;
$$;

comment on function public.subscription_renew_from_paymongo(text, text, text, numeric, text) is
  'Service-role-only entry point for the PayMongo webhook for the P999/month SOFTWARE LICENSE (court bookings use confirm_booking_from_paymongo instead). Idempotent on the PayMongo event id. Refuses a payment below business_subscription.monthly_fee or carrying an RB- booking reference, so a misrouted court payment can never grant a month of the product. outcome is one of: renewed | duplicate | amount_mismatch | not_a_license_payment.';

revoke all on function public.subscription_renew_from_paymongo(text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.subscription_renew_from_paymongo(text, text, text, numeric, text)
  to service_role;


-- ----------------------------------------------------------------------------
-- 2) Self-check: a P300 court booking must NOT renew the license.
--
-- Uses a throwaway event id and a real booking-shaped reference. It must come
-- back amount_mismatch / not_a_license_payment and must leave expires_at alone.
-- Raising an exception here fails the migration rather than shipping a guard
-- that does not actually guard.
-- ----------------------------------------------------------------------------
do $$
declare
  v_before timestamptz;
  v_after timestamptz;
  v_outcome text;
begin
  select s.expires_at into v_before
  from public.business_subscription s where s.id = true;

  select r.outcome into v_outcome
  from public.subscription_renew_from_paymongo(
    '__0031_selfcheck__',
    'pay_selftest',
    'RB-260926-000-XXXX',   -- a court booking reference, not the license link
    300,                    -- P300 court hour, not the P999 license fee
    'selfcheck'
  ) r;

  select s.expires_at into v_after
  from public.business_subscription s where s.id = true;

  if v_outcome not in ('amount_mismatch', 'not_a_license_payment') then
    raise exception '0031: a P300 booking payment was NOT rejected (outcome=%). The cross-product guard is not working.', v_outcome;
  end if;
  if v_after is distinct from v_before then
    raise exception '0031: the license expiry moved during the self-check. The guard is not working.';
  end if;

  -- Leave no trace: the self-check must not claim an event id.
  delete from public.payment_webhook_events where event_id = '__0031_selfcheck__';
  raise notice '0031: verified - a P300 court payment cannot renew the P999 license (outcome=%).', v_outcome;
end;
$$;
