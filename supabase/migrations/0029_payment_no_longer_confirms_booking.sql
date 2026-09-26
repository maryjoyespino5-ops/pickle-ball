-- ============================================================================
-- 0029_payment_no_longer_confirms_booking.sql
--
-- Decouple MONEY from the GAME:
--   payment_status = 'paid'  (GCash verified, or admin Mark paid)
--   status = 'pending'       (until the slot end time passes)
--   status = 'completed'     (only from complete_past_bookings)
--
-- 0021/0027 step (e) flipped bookings.status pending -> confirmed. That made
-- paid and confirmed disagree across dashboards. From here, confirmation
-- writes the PAYMENT row only. It never touches bookings.status.
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
  v_inserted integer := 0;
  v_payment public.payments%rowtype;
  v_booking public.bookings%rowtype;
  v_ref text;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'Missing PayMongo event id.';
  end if;
  insert into public.payment_webhook_events
    (event_id, provider, event_type, paymongo_payment_id, paymongo_link_reference,
     amount, status, detail)
  values
    (p_event_id, 'paymongo', p_event_type, p_payment_ref, p_session_ref,
     p_amount, 'processed', 'booking payment')
  on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    -- Already handled: report the matched booking without changing anything.
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
  -- (c) Amount cross-check against the booking amount. Refuse a short payment.
  if p_amount is not null and p_amount > 0
     and round(p_amount, 2) < round(v_booking.amount, 2) then
    return query select 'amount_mismatch'::text, v_booking.booking_number,
                        v_booking.status, v_booking.payment_status, p_amount;
    return;
  end if;
  v_ref := coalesce(nullif(p_payment_ref, ''), nullif(p_session_ref, ''), p_event_id);
  perform set_config('app.internal_payment_sync', 'on', true);
  -- (d) Payment row: paid + PayMongo reference. The 0019 trigger mirrors this
  -- onto bookings.payment_status. bookings.status stays 'pending': the slot is
  -- still upcoming, and complete_past_bookings() advances it after the game.
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
  perform set_config('app.internal_payment_sync', 'off', true);
  return query
    select 'paid'::text, b.booking_number, b.status, b.payment_status, p.amount
    from public.bookings b
    join public.payments p on p.booking_id = b.id
    where b.id = v_booking.id;
end;
$$;

comment on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text) is
  'Service-role-only entry point for the PayMongo webhook. Idempotent on the PayMongo event id; sets payments.status=paid (mirrored to bookings.payment_status). bookings.status is left alone so a paid game stays pending until it is played.';

revoke all on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text)
  to service_role;

do $$
declare
  v_outcome text;
begin
  select outcome into v_outcome
  from public.confirm_booking_from_paymongo(
    '__0029_selfcheck__',
    null,
    null,
    null,
    'GCash',
    'selfcheck'
  );
  if v_outcome is distinct from 'not_found' then
    raise exception '0029: self-check returned an unexpected outcome (%).', v_outcome;
  end if;
  delete from public.payment_webhook_events
   where event_id = '__0029_selfcheck__';
  raise notice '0029: verified — GCash confirmation writes payment_status only (outcome=%).', v_outcome;
end;
$$;
