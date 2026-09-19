-- ============================================================================
-- 0011_paddle_status_fix.sql
-- Fix the public paddle-status RPC so a linked booking ALWAYS drives the
-- paddle's QR status. Previously the RPC only looked at bookings dated
-- "today" (Asia/Manila) and picked the EARLIEST one, so:
--   * a booking linked for any other date was invisible  -> showed Available
--   * an earlier, already-finished booking masked a later one that was
--     currently in use                                    -> showed Available
-- New rule (mirrors the admin table logic in paddleService.js):
--   1. Ignore finished rentals (end already passed) and cancelled bookings.
--   2. Prefer the booking currently in progress (start <= now < end) -> in_use.
--   3. Otherwise the soonest upcoming booking -> reserved.
--   4. No linked/usable booking -> available.
-- ============================================================================

create or replace function public.get_paddle_status(p_token text)
returns table (
  id uuid,
  paddle_number text,
  name text,
  is_active boolean,
  status text,
  start_time timestamptz,
  end_time timestamptz
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
      (bk.booking_date + bk.start_time) at time zone 'Asia/Manila' as start_ts,
      ((bk.booking_date + bk.start_time) at time zone 'Asia/Manila')
        + make_interval(hours => bk.duration_hours) as end_ts
    from public.bookings bk
    where bk.paddle_id = (select p.id from p)
      and bk.status in ('upcoming', 'confirmed')
  ),
  relevant as (
    -- Active rental first; otherwise the soonest future rental. Finished
    -- rentals are ignored so they can never mask a current one.
    select start_ts, end_ts
    from windows
    where end_ts >= now()
    order by (start_ts <= now()) desc, start_ts asc
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
    r.end_ts
  from p
  left join relevant r on true;
$$;

-- Keep the existing grants (re-running keeps permissions intact).
grant execute on function public.get_paddle_status(text) to anon, authenticated;
