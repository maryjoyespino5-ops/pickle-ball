-- ============================================================================
-- 0007_admin_misc.sql
-- Final pieces for the admin side:
--   1) user_id becomes nullable so admins can create walk-in bookings for
--      customers who do not have an account.
--   2) btree_gist + an EXCLUDE constraint that prevents ANY overlapping
--      booking on the same court (multi-hour bookings included), even when
--      start times differ. This is the database-level guarantee the admin
--      calendar and booking flows rely on.
-- ============================================================================

alter table public.bookings alter column user_id drop not null;

create extension if not exists btree_gist;

alter table public.bookings drop constraint if exists bookings_no_overlap;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    court_id with =,
    tsrange(
      (booking_date + start_time),
      (booking_date + start_time) + make_interval(hours => duration_hours),
      '[)'
    ) with &&
  ) where (status <> 'cancelled');
