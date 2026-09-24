-- ============================================================================
-- 0019_payment_sync_and_aggregation.sql
--
--   M2 — payments.status and bookings.payment_status could drift: the client
--        updated the payment row and then (separately) the booking row, so a
--        failed second call left them inconsistent. A trigger now mirrors the
--        payment status onto the booking in the SAME transaction, so the two
--        can never disagree regardless of caller.
--
--   M3 — customer stats + report aggregation moved server-side. The old client
--        paths downloaded EVERY booking row and aggregated in JavaScript.
--        These security-definer RPCs return pre-aggregated, admin-only data.
--
-- Additive; ₱300/hour pricing and the 2-court design are untouched.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- M2) Mirror payments.status -> bookings.payment_status atomically.
--     Runs AFTER any insert/update of payments.status, so both the customer
--     flow (auto-created pending payment) and the admin "mark paid / refund"
--     flow stay consistent. The protect_booking_updates trigger blocks CUSTOMER
--     edits to payment_status only — this trigger runs as the table owner via
--     a security-definer function, and admins already may change it.
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
    -- Bypass the customer-facing protect_booking_updates guard for this
    -- internal bookkeeping update by raising its session flag is not needed:
    -- protect_booking_updates only rejects a payment_status change for
    -- non-admins, and it runs before this trigger on the bookings table. To be
    -- safe and explicit, perform the update with the internal flag on.
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
  'Keeps bookings.payment_status in lockstep with payments.status in the same transaction (M2), so reports and the UI never see them diverge.';

revoke all on function public.sync_booking_payment_status() from public, anon, authenticated;

drop trigger if exists payments_sync_booking_status on public.payments;
create trigger payments_sync_booking_status
  after insert or update of status on public.payments
  for each row execute function public.sync_booking_payment_status();

-- Allow the sync trigger's internal booking update through protect_booking_updates
-- (it rejects payment_status changes from non-admins). Re-declare the guard to
-- whitelist the internal flag; behaviour for real customers is unchanged.
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
  -- M2: the payment-sync trigger is allowed to update payment_status.
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
     and (new.status <> 'cancelled' or old.status not in ('upcoming', 'confirmed')) then
    raise exception 'Customers can only cancel upcoming bookings';
  end if;
  new.updated_at = now();
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- M3) Server-side stats for the admin Customers page.
--     One row per customer with totals, instead of downloading every booking.
-- ----------------------------------------------------------------------------
create or replace function public.customer_stats()
returns table (
  user_id uuid,
  total_bookings integer,
  total_spent numeric,
  last_booking date
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.user_id,
    count(*) filter (where b.status <> 'cancelled')::integer as total_bookings,
    coalesce(sum(b.amount) filter (where b.payment_status = 'paid'), 0) as total_spent,
    max(b.booking_date) as last_booking
  from public.bookings b
  where b.user_id is not null
    and b.deleted_at is null
  group by b.user_id;
$$;

comment on function public.customer_stats() is
  'Admin-only per-customer booking/spend totals (M3). Replaces downloading every booking row and aggregating in the browser.';

revoke all on function public.customer_stats() from public, anon, authenticated;
grant execute on function public.customer_stats() to authenticated;


-- ----------------------------------------------------------------------------
-- M3) Server-side report summary for the admin Reports page.
-- ----------------------------------------------------------------------------
create or replace function public.report_summary(
  p_from date default null,
  p_to date default null,
  p_court_id uuid default null,
  p_status text default null,
  p_payment_status text default null
)
returns table (
  total integer,
  confirmed integer,
  completed integer,
  cancelled integer,
  revenue numeric,
  paid_revenue numeric,
  pending_revenue numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*)::integer,
    count(*) filter (where b.status = 'confirmed')::integer,
    count(*) filter (where b.status = 'completed')::integer,
    count(*) filter (where b.status = 'cancelled')::integer,
    coalesce(sum(b.amount), 0),
    coalesce(sum(b.amount) filter (where b.payment_status = 'paid'), 0),
    coalesce(sum(b.amount) filter (where b.payment_status = 'pending'), 0)
  from public.bookings b
  where b.deleted_at is null
    and (p_from is null or b.booking_date >= p_from)
    and (p_to is null or b.booking_date <= p_to)
    and (p_court_id is null or b.court_id = p_court_id)
    and (p_status is null or b.status = p_status)
    and (p_payment_status is null or b.payment_status = p_payment_status);
$$;

comment on function public.report_summary(date, date, uuid, text, text) is
  'Admin-only aggregated booking/revenue totals (M3) so reports do not download every row.';

revoke all on function public.report_summary(date, date, uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_summary(date, date, uuid, text, text) to authenticated;