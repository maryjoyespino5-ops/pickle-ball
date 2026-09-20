-- ============================================================================
-- 0013_reject_past_bookings.sql
-- Customers could still create (and admins could still create/reschedule)
-- bookings for dates or start times that had already passed — the only
-- previous guards were `min` attributes on <input type="date">, which any
-- crafted request (or stale tab) bypasses. This adds the real rule at the
-- database level:
--   * booking_date may not be before today,
--   * a slot starting today may not begin at or before the current time
--     (you cannot join a session that is already in progress).
-- Times are compared in Asia/Manila: the facility operates there and booking
-- wall-clocks follow that local day (same convention as 0012_paddle_status_tz).
-- Status/payment updates on existing rows (complete, cancel, mark paid) do
-- NOT touch booking_date/start_time, so they keep working unchanged.
-- ============================================================================

create or replace function public.reject_past_booking_slot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;
  right_now time := (now() at time zone 'Asia/Manila')::time;
begin
  -- Only enforce when the schedule itself is being set or changed, so
  -- completing, cancelling or paying an existing (possibly past) booking
  -- still works.
  if tg_op = 'UPDATE'
     and new.booking_date is not distinct from old.booking_date
     and new.start_time is not distinct from old.start_time then
    return new;
  end if;

  if new.booking_date < today then
    raise exception
      'That date has already passed. Please choose today or a future date.';
  end if;

  if new.booking_date = today and new.start_time <= right_now then
    raise exception
      'That time has already passed. Please choose a later slot.';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_reject_past_slot on public.bookings;
create trigger bookings_reject_past_slot
  before insert or update on public.bookings
  for each row execute function public.reject_past_booking_slot();