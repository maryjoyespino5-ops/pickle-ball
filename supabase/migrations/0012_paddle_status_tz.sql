-- ============================================================================
-- 0012_paddle_status_tz.sql
-- The rest of the application stores booking_date/start_time as wall-clock
-- time in whatever timezone the booking was made from (the browser's). The
-- previous RPC hardcoded Asia/Manila, so for any user outside UTC+8 the
-- rental windows landed hours away from "now" and a booked paddle showed
-- Available. This version:
--   * accepts the caller's UTC offset (minutes) so windows match the timezone
--     the booking was created in,
--   * defaults to Asia/Manila (+480) when the offset is not provided,
--   * also returns the rental name, booking date and court so the QR page can
--     display them (still NO email/phone — see Security note below).
-- Security: only paddle + booking schedule fields are exposed publicly.
-- ============================================================================

drop function if exists public.get_paddle_status(text);

create function public.get_paddle_status(
  p_token text,
  p_offset_minutes integer default 480
)
returns table (
  id uuid,
  paddle_number text,
  name text,
  is_active boolean,
  status text,
  start_time timestamptz,
  end_time timestamptz,
  rental_name text,
  booking_date date,
  court_name text
)
language sql
security definer
set search_path = public
stable
as $$
  with p as (
    select pt.id, pt.paddle_number, pt.name, pt.is_active
    from public.paddles pt
    where pt.qr_token = p_token
    limit 1
  ),
  windows as (
    select
      bk.booking_number,
      bk.customer_name,
      bk.booking_date,
      bk.court_id,
      ((bk.booking_date + bk.start_time) at time zone
         make_interval(mins => p_offset_minutes)) as start_ts,
      (((bk.booking_date + bk.start_time) at time zone
         make_interval(mins => p_offset_minutes))
        + make_interval(hours => bk.duration_hours)) as end_ts
    from public.bookings bk
    where bk.paddle_id = (select p.id from p)
      and bk.status in ('upcoming', 'confirmed')
  ),
  relevant as (
    -- Active rental first; otherwise the soonest upcoming one. Finished
    -- rentals are ignored so they can never mask a current one.
    select w.*
    from windows w
    where w.end_ts >= now()
    order by (w.start_ts <= now()) desc, w.start_ts asc
    limit 1
  )
  select
    p.id,
    p.paddle_number,
    p.name,
    p.is_active,
    case
      when not p.is_active then 'disabled'
      when r.start_ts is not null and now() >= r.start_ts then 'in_use'
      when r.start_ts is not null then 'reserved'
      else 'available'
    end,
    r.start_ts,
    r.end_ts,
    r.customer_name,
    r.booking_date,
    c.name
  from p
  left join relevant r on true
  left join public.courts c on c.id = r.court_id;
$$;

grant execute on function public.get_paddle_status(text, integer) to anon, authenticated;
