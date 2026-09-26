-- ============================================================================
-- 0024_simplify_booking_status.sql
--
-- Simplify the booking lifecycle to FOUR states, in this exact order:
--
--     pending  ->  confirmed  ->  completed  ->  cancelled
--
-- and the payment lifecycle to TWO:
--
--     pending  ->  paid
--
-- Behaviour this migration enforces server-side (so the player and admin
-- dashboards can never disagree):
--
--   1. A new booking starts  status='pending',  payment_status='pending'.
--      'upcoming' is retired — the old value is migrated to 'pending' and the
--      CHECK constraint no longer allows it.
--
--   2. GCash success: confirm_booking_from_paymongo (0021) already sets
--      payment_status='paid' AND status='confirmed' in ONE transaction. Its
--      guard currently only accepts old.status in ('upcoming','confirmed');
--      that is widened to ('pending','confirmed') so the simplified flow works.
--
--   3. Pay at Court: nothing changes — payment stays 'pending' until an admin
--      marks it paid. A cash booking is 'pending' until its time passes.
--
--   4. After the scheduled end time a booking becomes 'completed'
--      AUTOMATICALLY — complete_past_bookings() plus a pg_cron schedule. No
--      admin "Complete Booking" action exists any more.
--
--   5. "Confirm Booking" is removed as a manual admin action. Status only
--      advances on its own (payment -> confirmed) or by time (-> completed).
--      Admins keep Cancel and Reschedule.
--
--   6. Admin-only manual status writes are now restricted to the two actions
--      that remain: a cancel, or a reschedule (which does not touch status).
--      Because the completion is time-driven, nothing else needs a manual
--      status set.
--
-- Not touched: pricing (₱300/hr), the 2-court design, the double-booking
-- constraints, PayMongo identifiers and the reconciliation RPCs.
-- ============================================================================


-- ============================================================================
-- ORDER MATTERS. protect_booking_updates rejects a status write it does not
-- recognise, and the 0021 body only permits a transition into 'confirmed' — so
-- the 'upcoming' -> 'pending' data pass below would fail with
-- "Customers can only cancel upcoming bookings". The NEW guard is therefore
-- installed first (step 1), then the data pass (step 2), then the constraints
-- (step 3), then completion + admin cancel (steps 4-6).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Install the simplified guard, widened to the new lifecycle:
--      pending -> confirmed            (verified payment, server flag only)
--      pending/confirmed -> completed   (automatic, after the slot ends)
--      pending/confirmed -> cancelled   (customer or admin)
--    Everything else is unchanged: booking details and payment_status stay
--    locked to the sync trigger, and a client can never raise the flags.
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
  'Guards booking writes: customers may only cancel an open (pending/confirmed) booking; payment confirmation, auto-completion and the upcoming->pending retirement run through service-role-only session flags.';


-- ----------------------------------------------------------------------------
-- 2) Relax the CHECK constraint BEFORE the data pass.
--    The 0003 constraint allows ('upcoming','confirmed','completed','cancelled')
--    — it does not know 'pending' yet, so writing 'pending' below would fail
--    with 23514. The interim constraint accepts both the old and the new
--    vocabulary; step 3 tightens it to the final four values once no
--    'upcoming' row is left.
-- ----------------------------------------------------------------------------
alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'upcoming', 'confirmed', 'completed', 'cancelled'));


-- ----------------------------------------------------------------------------
-- 3) Migrate the retired 'upcoming' value to 'pending', now that both the guard
--    and the constraint accept it.
-- ----------------------------------------------------------------------------
do $$
declare
  v_moved integer := 0;
begin
  perform set_config('app.internal_payment_sync', 'on', true);
  perform set_config('app.booking_server_confirm', 'on', true);

  update public.bookings b
     set status = 'pending',
         updated_at = now()
   where b.status = 'upcoming';

  get diagnostics v_moved = row_count;
  raise notice '0024: migrated % booking(s) from upcoming -> pending.', v_moved;

  perform set_config('app.booking_server_confirm', 'off', true);
  perform set_config('app.internal_payment_sync', 'off', true);
end;
$$;


-- ----------------------------------------------------------------------------
-- 4) Tighten the booking constraint to the final four states now that every
--    'upcoming' row is gone. From here on 'upcoming' is rejected by the
--    database itself.
-- ----------------------------------------------------------------------------
alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'completed', 'cancelled'));

comment on column public.bookings.status is
  'Booking lifecycle: pending -> confirmed -> completed, or cancelled. Advance to confirmed automatically when GCash payment is verified; advance to completed automatically after the scheduled end time.';

-- Payment lifecycle: pending -> paid. 'refunded' is retained because the admin
-- Payments page has a Refund action (paymentService.updatePayment); removing it
-- would break refunds and orphan existing refunded rows.
alter table public.payments
  drop constraint if exists payments_status_check;

alter table public.payments
  add constraint payments_status_check
  check (status in ('pending', 'paid', 'refunded'));

comment on column public.payments.status is
  'Payment lifecycle: pending -> paid (-> refunded by an admin). Set to paid by the verified PayMongo webhook (GCash) or by an admin for Pay at Court.';

-- Default for new bookings: the lifecycle starts at 'pending'.
alter table public.bookings
  alter column status set default 'pending';


-- ----------------------------------------------------------------------------
-- 4) Automatic completion.
--    A booking is COMPLETED once its scheduled END time has passed, unless it
--    was cancelled. End time is computed in the facility timezone
--    (Asia/Manila), matching the past-slot rule in 0013.
--
--    security definer so it can advance status past the booking guard, and
--    callable by an admin (manual "run now") or by pg_cron (scheduled).
-- ----------------------------------------------------------------------------
create or replace function public.complete_past_bookings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed integer := 0;
begin
  perform set_config('app.booking_server_confirm', 'on', true);

  update public.bookings b
     set status = 'completed',
         updated_at = now()
   where b.deleted_at is null
     and b.status in ('pending', 'confirmed')
     and (
       (b.booking_date + b.start_time
          + make_interval(hours => b.duration_hours))
         at time zone 'Asia/Manila'
     ) < now();

  get diagnostics v_completed = row_count;

  perform set_config('app.booking_server_confirm', 'off', true);
  return v_completed;
end;
$$;

comment on function public.complete_past_bookings() is
  'Marks every pending/confirmed booking whose scheduled end time (Asia/Manila) has passed as completed. Returns the number of rows advanced. Run by pg_cron and by the admin "run now" action.';

revoke all on function public.complete_past_bookings() from public, anon;
grant execute on function public.complete_past_bookings() to authenticated, service_role;


-- 4b) Schedule it. pg_cron may not be available on every project, so the
--     extension and the schedule are both best-effort: if pg_cron is missing
--     the function still exists and an admin (or the app load) can call it.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice '0024: pg_cron unavailable (%). Schedule complete_past_bookings() another way.', sqlerrm;
end;
$$;

do $$
begin
  -- Every 5 minutes. Unschedule first so re-running this migration is safe.
  perform cron.unschedule('complete-past-bookings')
  where exists (select 1 from cron.job where jobname = 'complete-past-bookings');

  perform cron.schedule(
    'complete-past-bookings',
    '*/5 * * * *',
    $cron$select public.complete_past_bookings();$cron$
  );
  raise notice '0024: scheduled complete_past_bookings() every 5 minutes.';
exception when others then
  raise notice '0024: could not schedule pg_cron job (%).', sqlerrm;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5) Admin status writes: only Cancel remains.
--    With auto-completion and auto-confirm, the only manual status change an
--    admin needs is cancelling. This helper is the single supported entry
--    point, so the client has nothing to guess about.
-- ----------------------------------------------------------------------------
create or replace function public.admin_cancel_booking(p_booking_number text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can cancel a booking.';
  end if;

  update public.bookings b
     set status = 'cancelled',
         updated_at = now()
   where b.booking_number = btrim(coalesce(p_booking_number, ''))
     and b.deleted_at is null
     and b.status <> 'cancelled'
  returning b.status into v_status;

  if v_status is null then
    raise exception 'Booking was not found, or it is already cancelled.';
  end if;

  return v_status;
end;
$$;

comment on function public.admin_cancel_booking(text) is
  'Admin-only: cancels a booking. Cancel and Reschedule are the only manual booking actions; confirm/complete happen automatically.';

revoke all on function public.admin_cancel_booking(text) from public, anon;
grant execute on function public.admin_cancel_booking(text) to authenticated;


-- ----------------------------------------------------------------------------
-- 6) Immediate consistency pass: complete anything already past its end time,
--    so the dashboards agree the moment this migration lands instead of
--    waiting for the next cron tick.
-- ----------------------------------------------------------------------------
do $$
declare
  v_done integer;
begin
  v_done := public.complete_past_bookings();
  raise notice '0024: completed % booking(s) that were already past their slot.', v_done;
end;
$$;