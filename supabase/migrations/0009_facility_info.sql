-- ============================================================================
-- 0009_facility_info.sql
-- Public facility-info RPC (B7/B8). Lets anonymous visitors and customers read
-- the facility's opening/closing hours, duration rules and the lowest active
-- court price WITHOUT exposing RLS-protected rows. Powers the Pricing page,
-- Home hero rate, the Availability slot grid, and the customer duration picker.
-- ============================================================================

create or replace function public.get_facility_info()
returns table (
  facility_name text,
  address text,
  contact text,
  facility_email text,
  opening_time time,
  closing_time time,
  default_duration integer,
  max_duration integer,
  min_price numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.facility_name,
    s.address,
    s.contact,
    s.facility_email,
    s.opening_time,
    s.closing_time,
    s.default_duration,
    s.max_duration,
    (
      select min(c.price_per_hour)
      from public.courts c
      where c.is_active
        and coalesce(c.maintenance, false) = false
    ) as min_price
  from public.facility_settings s
  limit 1;
$$;

-- Anonymous visitors and authenticated customers can all read facility info.
grant execute on function public.get_facility_info() to anon, authenticated;