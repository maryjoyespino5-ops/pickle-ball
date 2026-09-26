-- ============================================================================
-- 0030_payment_single_source_of_truth.sql
--
-- Fixes the "Player says PAID, Payments says PENDING" split brain.
--
-- THE BUG
--   bookings.payment_status and payments.status are two columns that must
--   always agree, but only ONE direction was ever synchronised: migration
--   0019 added payments_sync_booking_status (payments -> bookings). Nothing
--   ever mirrored bookings -> payments.
--
--   The admin "Mark paid" buttons (admin Bookings + admin Dashboard) call
--   bookingService.updateBooking(id, { paymentStatus: 'paid' }), which writes
--   bookings.payment_status DIRECTLY. That left payments.status untouched, so:
--     * pages reading bookings  (Player My Bookings, Booking History,
--                               Admin Bookings, Admin Booking details)
--         showed  PAID
--     * pages reading payments   (Player Payments, Admin Payments)
--         showed  PENDING
--   35 of 72 bookings were in that drifted state.
--
-- THE FIX
--   1. Add the missing mirror: bookings -> payments, so the pair converges no
--      matter which side anybody writes.
--   2. Backfill the drifted rows so the two dashboards agree immediately.
--   3. Document the confirm_booking_from_paymongo outcome contract, which 0029
--      changed from 'confirmed' to 'paid' while its caller still read the old
--      literal.
--   4. Normalise legacy status='confirmed' rows back to 'pending', because
--      since 0029 a payment no longer confirms a booking.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1a) bookings.payment_status -> payments.status  (the missing mirror)
--
-- SECURITY DEFINER because the customer-facing RLS on payments is scoped to
-- auth.uid() = user_id, and this must also run for admin writes on any booking.
-- The function is revoked from every role below.
--
-- The "is distinct from" guard is what makes the two triggers safe together:
--   admin writes bookings -> we set payments -> the 0019 trigger sets bookings
--   again, but by then the value is unchanged, so this trigger returns early
--   and the chain stops. No infinite recursion, no lock pile-up.
-- ----------------------------------------------------------------------------
create or replace function public.sync_payment_row_from_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status is distinct from old.payment_status
     and new.deleted_at is null then
    update public.payments p
       set status = new.payment_status,
           -- A payment that becomes paid gets a settlement timestamp; we keep
           -- any existing one so a re-mark never moves paid_at.
           paid_at = case
                       when new.payment_status = 'paid'
                         then coalesce(p.paid_at, now())
                       else p.paid_at
                     end
     where p.booking_id = new.id
       and p.deleted_at is null
       and p.status is distinct from new.payment_status;
  end if;
  return new;
end;
$$;

comment on function public.sync_payment_row_from_booking() is
  'Mirrors bookings.payment_status onto the booking''s payments row. Added in 0030: 0019 only synced the other direction, so an admin "Mark paid" (which writes bookings.payment_status directly) left payments.status stale and the Payments pages disagreed with the booking pages.';

revoke all on function public.sync_payment_row_from_booking() from public, anon, authenticated;

drop trigger if exists bookings_sync_payment_row on public.bookings;
create trigger bookings_sync_payment_row
  after update of payment_status on public.bookings
  for each row execute function public.sync_payment_row_from_booking();


-- ----------------------------------------------------------------------------
-- 1b) Re-declare the existing payments -> bookings mirror.
--
-- 0019 already created it; redefining it here keeps both directions in one
-- migration, so a database built from scratch gets the same symmetric
-- behaviour as a patched one and the two cannot drift apart again.
-- ----------------------------------------------------------------------------
create or replace function public.sync_booking_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_id is not null
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    -- protect_booking_updates (0019) rejects a customer payment_status change;
    -- this internal bookkeeping write is whitelisted by the session flag.
    perform set_config('app.internal_payment_sync', 'on', true);
    update public.bookings
       set payment_status = new.status,
           updated_at = now()
     where id = new.booking_id;
    perform set_config('app.internal_payment_sync', 'off', true);
  end if;
  return new;
end;
$$;

comment on function public.sync_booking_payment_status() is
  'Keeps bookings.payment_status in lockstep with payments.status in the same transaction, so reports and every dashboard read the same settled state.';

revoke all on function public.sync_booking_payment_status() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) Backfill the drift.
--
-- Deliberately one-directional: only bookings that say 'paid' while the
-- payment row does not are promoted. An admin already asserted those were
-- collected, and the payment row is the column that was simply never updated.
-- An existing paid_at is preserved, so this never rewrites settlement history.
-- ----------------------------------------------------------------------------
do $$
declare
  v_fixed integer := 0;
begin
  update public.payments p
     set status = 'paid',
         paid_at = coalesce(p.paid_at, now())
    from public.bookings b
   where b.id = p.booking_id
     and b.deleted_at is null
     and p.deleted_at is null
     and b.payment_status = 'paid'
     and p.status <> 'paid';

  get diagnostics v_fixed = row_count;
  raise notice '0030: repaired % payment row(s) that were behind their booking.', v_fixed;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3) Legacy 'confirmed' rows.
--
-- Since 0029 a booking is no longer confirmed by paying for it, so a row that
-- still reads status='confirmed' is a leftover from the old lifecycle and is
-- exactly the "Booking: Confirmed / Payment: Pending" confusion this fixes.
-- Only UNPAID ones are reset: a paid 'confirmed' row is just a played-out
-- booking whose status was never advanced to 'completed' by complete_past_bookings.
--
-- 3a) The 0024 guard whitelists server-side transitions, but that list has no
--     'confirmed' -> 'pending' entry (0029 removed the transition that used to
--     produce it), so this one-off retirement would be rejected with
--     "Customers can only cancel an open booking". It is added here as a
--     strictly NARROWER branch: only the server_confirm flag can take a
--     confirmed booking back to pending, it may not touch payment_status, and
--     every other customer-reachable guard is left exactly as it was.
-- ----------------------------------------------------------------------------
create or replace function public.protect_booking_updates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  claiming_guest boolean :=
    coalesce(current_setting('app.guest_booking_claim', true), 'off') = 'on';
  internal_payment boolean :=
    coalesce(current_setting('app.internal_payment_sync', true), 'off') = 'on';
  server_confirm boolean :=
    coalesce(current_setting('app.booking_server_confirm', true), 'off') = 'on';
begin
  if new.user_id is distinct from old.user_id then
    if not (
      claiming_guest
      and old.user_id is null
      and new.user_id is not null
      and new.user_id = auth.uid()
    ) then
      raise exception 'Booking owner cannot be changed';
    end if;
  end if;
  if public.is_admin() then
    new.updated_at = now();
    return new;
  end if;
  -- The payment-sync trigger may update payment_status only.
  if internal_payment
     and new.court_id is not distinct from old.court_id
     and new.booking_date is not distinct from old.booking_date
     and new.start_time is not distinct from old.start_time
     and new.duration_hours is not distinct from old.duration_hours
     and new.amount is not distinct from old.amount
     and new.booking_number is not distinct from old.booking_number
     and new.status is not distinct from old.status
     and new.customer_name is not distinct from old.customer_name
     and new.customer_email is not distinct from old.customer_email
     and new.customer_phone is not distinct from old.customer_phone then
    new.updated_at = now();
    return new;
  end if;
  -- Server-side transitions (verified payment, automatic completion, and the
  -- 'upcoming' retirement). Only a SECURITY DEFINER function raises this flag.
  if server_confirm
     and new.court_id is not distinct from old.court_id
     and new.booking_date is not distinct from old.booking_date
     and new.start_time is not distinct from old.start_time
     and new.duration_hours is not distinct from old.duration_hours
     and new.amount is not distinct from old.amount
     and new.booking_number is not distinct from old.booking_number
     and new.customer_name is not distinct from old.customer_name
     and new.customer_email is not distinct from old.customer_email
     and new.customer_phone is not distinct from old.customer_phone
     and (
       -- verified payment, or a replay of one: pending -> confirmed
       (new.status = 'confirmed'
          and old.status in ('pending', 'confirmed'))
       -- automatic completion, or a replay of one
       or (new.status = 'completed'
             and old.status in ('pending', 'confirmed', 'completed'))
       -- one-time retirement of the legacy value
       or (new.status = 'pending' and old.status = 'upcoming')
       -- 0030: retirement of the legacy 'confirmed' state, which 0029 stopped
       -- producing now that a payment no longer confirms a booking. The
       -- payment_status check above keeps this a status-only change.
       or (new.status = 'pending'
             and old.status = 'confirmed'
             and new.payment_status is not distinct from old.payment_status)
     ) then
    new.updated_at = now();
    return new;
  end if;
  if new.court_id is distinct from old.court_id
     or new.booking_date is distinct from old.booking_date
     or new.start_time is distinct from old.start_time
     or new.duration_hours is distinct from old.duration_hours
     or new.amount is distinct from old.amount
     or new.booking_number is distinct from old.booking_number
     or new.payment_status is distinct from old.payment_status
     or new.customer_name is distinct from old.customer_name
     or new.customer_email is distinct from old.customer_email
     or new.customer_phone is distinct from old.customer_phone then
    raise exception 'Booking details and payment status cannot be modified after booking';
  end if;
  if new.status is distinct from old.status
     and (
       new.status <> 'cancelled'
       or old.status not in ('pending', 'confirmed')
     ) then
    raise exception 'Customers can only cancel an open booking';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.protect_booking_updates() is
  'Guards booking writes: customers may only cancel an open (pending/confirmed) booking; payment confirmation, auto-completion and the legacy upcoming/confirmed retirements run through service-role-only session flags.';


-- ----------------------------------------------------------------------------
-- 3b) The retirement itself, now that the guard accepts it.
-- ----------------------------------------------------------------------------
do $$
declare
  v_fixed integer := 0;
begin
  perform set_config('app.booking_server_confirm', 'on', true);

  update public.bookings
     set status = 'pending',
         updated_at = now()
   where deleted_at is null
     and status = 'confirmed'
     and payment_status <> 'paid';

  get diagnostics v_fixed = row_count;
  raise notice '0030: reset % legacy confirmed booking(s) to pending.', v_fixed;

  perform set_config('app.booking_server_confirm', 'off', true);
end;
$$;




-- ----------------------------------------------------------------------------
-- 4) The confirm_booking_from_paymongo outcome contract.
--
-- 0029 changed the success literal from 'confirmed' to 'paid' (the function now
-- settles MONEY and deliberately leaves bookings.status alone). The
-- paymongo-verify fallback still compared against 'confirmed', so a genuinely
-- successful GCash payment came back as paid:false and the player kept seeing
-- PENDING. The caller fix ships in supabase/functions/paymongo-verify/index.ts;
-- the contract is pinned here so it cannot be re-broken:
--
--   'paid'            payment settled, booking status intentionally untouched
--   'duplicate'       this PayMongo event id was already processed
--   'not_found'       no payment row matches the PayMongo identifiers
--   'amount_mismatch' PayMongo collected less than the booking is worth
-- ----------------------------------------------------------------------------
comment on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text) is
  'Service-role-only entry point for the PayMongo webhook. Idempotent on the PayMongo event id. Sets payments.status=''paid'' (mirrored to bookings.payment_status by the 0019/0030 triggers) and leaves bookings.status alone, so a paid game stays pending until it is actually played. outcome is one of: paid | duplicate | not_found | amount_mismatch.';