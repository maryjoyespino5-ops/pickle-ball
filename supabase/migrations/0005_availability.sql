-- ============================================================================
-- 0005_availability.sql
-- Security-definer RPC used by the public "Availability" page so anonymous and
-- authenticated users can see which slots are taken WITHOUT seeing who booked.
-- Only exposes (court_id, start_time) pairs for a given date.
-- ============================================================================

create or replace function public.get_booked_slots(p_date date)
returns table (court_id uuid, start_time time)
language sql
security definer
set search_path = public
stable
as $$
  select b.court_id, b.start_time
  from public.bookings b
  where b.booking_date = p_date
    and b.status <> 'cancelled'
  order by b.start_time;
$$;

-- Available to unauthenticated (anon) and authenticated users alike.
-- The function itself filters the data to just slot coordinates.
grant execute on function public.get_booked_slots(date) to anon, authenticated;