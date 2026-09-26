-- ============================================================================
-- 0025_cancel_refunds_paid_booking.sql
--
-- 0024 introduced public.admin_cancel_booking(text) as the single supported way
-- for an admin to cancel a booking, taking the manual "Confirm" and "Complete"
-- buttons away from the client. What 0024 did not carry over is the other half
-- of the flow it replaced (src/pages/admin/Bookings.jsx): cancelling a booking
-- whose payment had already been collected also marked that payment refunded.
-- Without it an admin cancel leaves the booking cancelled while the money still
-- reads "paid".
--
-- 0024 is already applied to the linked project, so it is not edited. This
-- migration only replaces the function body: the security check, the error
-- messages, the return value and the grants are unchanged.
--
-- What the function now does, in order:
--   1. cancel the booking, refusing one that is already cancelled
--   2. refund its payment when that payment was already 'paid'
--
-- Step 2 writes payments.status, which fires payments_sync_booking_status
-- (0019) and mirrors the value onto bookings.payment_status in the SAME
-- transaction, so bookings.status, bookings.payment_status and payments.status
-- can never disagree. An unpaid payment is left alone: there is no cash to
-- return, and a cancelled booking is never paid.
--
-- Existing rows are deliberately NOT rewritten here: "cancelled + paid" from
-- before this rule may be a customer cancellation that the facility chose not
-- to refund, so the decision stays with the admin. The Payments page keeps its
-- explicit Refund action for those rows.
-- ============================================================================

create or replace function public.admin_cancel_booking(p_booking_number text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
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
  returning b.id, b.status into v_booking_id, v_status;

  if v_status is null then
    raise exception 'Booking was not found, or it is already cancelled.';
  end if;

  update public.payments p
     set status = 'refunded'
   where p.booking_id = v_booking_id
     and p.status = 'paid';

  return v_status;
end;
$$;

comment on function public.admin_cancel_booking(text) is
  'Admin-only: cancels a booking and refunds its payment when it was already paid. Cancel and Reschedule are the only manual booking actions, while confirm/complete happen automatically.';

revoke all on function public.admin_cancel_booking(text) from public, anon;
grant execute on function public.admin_cancel_booking(text) to authenticated;
