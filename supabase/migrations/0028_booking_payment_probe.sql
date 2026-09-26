-- ============================================================================
-- 0028_booking_payment_probe.sql
--
-- Support for the paymongo-verify Edge Function: the last line of defence that
-- turns a successful GCash payment into PAID (+ CONFIRMED) even when the
-- webhook never arrived (not configured for checkout_session.payment.paid, a
-- delivery lost, a failed retry, a cold function, ...).
--
-- The Edge Function asks PayMongo directly for the Checkout Session it created
-- for the booking. To do that it needs the stored cs_... / pay_... identifiers,
-- and it must only ever be allowed to answer for the caller's OWN booking.
--
-- booking_payment_probe() is exactly that read, with the same authorisation
-- rule as begin_booking_paymongo_checkout() (0021):
--
--     * the signed-in owner            (p_caller_id = bookings.user_id)
--     * the holder of the guest token  (p_guest_token = bookings.guest_token)
--     * an administrator
--
-- Unlike begin_booking_paymongo_checkout it never raises for an already paid
-- booking — it is a read, and the caller needs to see that settled state.
--
-- service_role only: the identity check is done INSIDE the function from the
-- parameters the Edge Function resolved server-side (auth.getUser() on the
-- caller's JWT, plus the guest token from the request body), so a browser can
-- never probe somebody else's booking.
-- ============================================================================


create or replace function public.booking_payment_probe(
  p_booking_number text,
  p_caller_id uuid default null,
  p_guest_token text default null
)
returns table (
  booking_number text,
  booking_status text,
  payment_status text,
  amount numeric,
  payment_method text,
  reference text,
  paid_at timestamptz,
  paymongo_checkout_session_id text,
  paymongo_payment_id text
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select * into v_booking
  from public.bookings b
  where b.booking_number = btrim(coalesce(p_booking_number, ''))
    and b.deleted_at is null;

  if v_booking.id is null then
    raise exception 'Booking was not found.';
  end if;

  if not (
    (p_caller_id is not null and v_booking.user_id = p_caller_id)
    or (
      v_booking.guest_token is not null
      and p_guest_token is not null
      and v_booking.guest_token = btrim(p_guest_token)
    )
    or public.is_admin()
  ) then
    -- Deliberately vague: do not reveal whether the booking exists.
    raise exception 'You are not allowed to check this booking.';
  end if;

  return query
    select
      v_booking.booking_number,
      v_booking.status,
      v_booking.payment_status,
      v_booking.amount,
      p.method,
      coalesce(p.paymongo_reference, p.reference),
      coalesce(p.paymongo_paid_at, p.paid_at),
      p.paymongo_checkout_session_id,
      p.paymongo_payment_id
    from (select 1) dummy
    left join public.payments p on p.booking_id = v_booking.id;
end;
$$;

comment on function public.booking_payment_probe(text, uuid, text) is
  'Service-role-only read for the paymongo-verify Edge Function: returns one booking''s payment state plus the stored PayMongo session/payment ids, for the owner, the holder of the guest token, or an admin. Never writes.';

revoke all on function public.booking_payment_probe(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.booking_payment_probe(text, uuid, text)
  to service_role;
