-- ============================================================================
-- 0016_booking_hours_check.sql
--
-- Fixes a conflict the guest booking flow exposed.
--
-- 0003_bookings.sql pinned start_time to a hard-coded window:
--
--     check (start_time >= time '07:00' and start_time <= time '21:00'
--            and extract(minute from start_time) = 0)
--
-- but the admin Settings page lets the facility choose ANY opening/closing
-- time, and 0006 seeds facility_settings.id = true with defaults. When the
-- admin widens the hours (the linked project runs 01:00 - 23:00), the booking
-- grid is built from those hours — so the public/customer booking pages offer
-- hours the table then rejects with a raw
-- "violates check constraint bookings_start_time_check", both for the guest
-- flow (create_guest_booking) and the signed-in flow (createBooking).
--
-- The real rules that must hold are:
--   * the slot starts exactly on the hour                -> keep it
--   * the slot falls inside the configured opening hours  -> keep it, but read
--     the hours from facility_settings instead of hard-coding them
--   * the slot is not in the past                         -> already enforced by
--     0013_reject_past_bookings.sql
--
-- The facility window is checked against facility_settings rather than via a
-- plain CHECK, because a CHECK cannot read another table. A trigger is also
-- what the existing booking rules already use (assign_booking_number,
-- set_booking_amount, protect_booking_updates), so this stays consistent.
-- ============================================================================

-- 1) Drop the stale hard-coded window; the on-the-hour rule is re-added below
--    inside the trigger so the existing behaviour is preserved.
alter table public.bookings
  drop constraint if exists bookings_start_time_check;

-- A booking must still start on the hour — that rule is independent of the
-- facility's configured hours and stays a plain CHECK.
alter table public.bookings
  add constraint bookings_start_time_on_hour
  check (extract(minute from start_time) = 0);

-- 2) Enforce the configured opening hours on insert, and on any update that
--    moves the slot (the protect trigger already blocks customers from moving
--    a slot at all; this covers admins rescheduling).
create or replace function public.assert_booking_within_hours()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_opening time;
  v_closing time;
  v_duration integer := coalesce(new.duration_hours, 1);
  v_end time;
begin
  -- Hours are only relevant when the booking actually has a start time.
  if new.start_time is null then
    return new;
  end if;

  select fs.opening_time, fs.closing_time
    into v_opening, v_closing
  from public.facility_settings fs
  where fs.id = true;

  -- No settings row yet -> fall back to the original 07:00-22:00 window so a
  -- half-provisioned database cannot accept nonsense.
  v_opening := coalesce(v_opening, time '07:00');
  v_closing := coalesce(v_closing, time '22:00');

  if new.start_time < v_opening or new.start_time >= v_closing then
    raise exception
      'That time is outside the facility opening hours (% to %).',
      to_char(v_opening, 'HH24:MI'), to_char(v_closing, 'HH24:MI');
  end if;

  -- A multi-hour booking must also END by closing time: the last hour has to
  -- finish before the facility closes, otherwise the grid would offer a start
  -- hour whose booking runs past closing.
  v_end := new.start_time + make_interval(hours => v_duration);
  if v_end > v_closing then
    raise exception
      'A % hour booking starting at % would run past the % closing time. Please choose an earlier hour or a shorter duration.',
      v_duration, to_char(new.start_time, 'HH24:MI'),
      to_char(v_closing, 'HH24:MI');
  end if;

  return new;
end;
$$;

comment on function public.assert_booking_within_hours() is
  'Rejects bookings whose start_time falls outside the facility_settings opening/closing hours. Replaces the hard-coded 07:00-21:00 CHECK from 0003 so the admin Settings page can widen or narrow the bookable window.';

drop trigger if exists bookings_within_hours on public.bookings;
create trigger bookings_within_hours
  before insert or update of start_time, booking_date, court_id, duration_hours
  on public.bookings
  for each row execute function public.assert_booking_within_hours();