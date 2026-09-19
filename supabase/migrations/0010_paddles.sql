-- ============================================================================
-- 0010_paddles.sql
-- Paddle QR-code management for the existing booking system:
--   1) `paddles` table — one row per physical paddle, each with a unique
--      qr_token. Admins manage rows directly; the public QR scan page reads
--      only through the security-definer RPC below (never raw table access).
--   2) `bookings.paddle_id` — optional link from an existing booking to a
--      paddle. The paddle's "In Use" status, rental start/end and remaining
--      time are DERIVED from the existing booking row (booking_date +
--      start_time + duration_hours). No duplicate booking system is created.
--   3) get_paddle_status(token) RPC — exposes ONLY non-sensitive paddle info
--      to anonymous phone visitors (paddle number, availability, start/end).
--      Customer names/emails/phones are intentionally never returned.
-- ============================================================================

create table if not exists public.paddles (
  id uuid primary key default gen_random_uuid(),
  paddle_number text not null unique,
  name text not null default '',
  qr_token text not null unique,
  status text not null default 'available'
    check (status in ('available', 'in_use')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh (reuses the generic touch function from 0001_profiles).
drop trigger if exists paddles_touch_updated_at on public.paddles;
create trigger paddles_touch_updated_at
  before update on public.paddles
  for each row execute function public.touch_updated_at();

-- RLS: only admins can read/insert/update/delete paddles. Anonymous users and
-- customers use get_paddle_status() instead, which never leaks renter data.
alter table public.paddles enable row level security;

drop policy if exists "paddles_admin_select" on public.paddles;
create policy "paddles_admin_select"
  on public.paddles for select
  using (public.is_admin());

drop policy if exists "paddles_admin_all" on public.paddles;
create policy "paddles_admin_all"
  on public.paddles for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Link the EXISTING bookings table to paddles (nullable, non-breaking).
-- Deleting a paddle keeps the booking and simply clears the link.
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists paddle_id uuid;
alter table public.bookings drop constraint if exists bookings_paddle_fk;
alter table public.bookings add constraint bookings_paddle_fk
  foreign key (paddle_id) references public.paddles (id) on delete set null;

create index if not exists bookings_paddle_id_idx on public.bookings (paddle_id);

-- ---------------------------------------------------------------------------
-- Public status lookup by QR token (used by the phone scan page at
-- /paddle/:token). Returns only: paddle identity, availability, and the
-- derived rental window. NEVER returns customer information.
-- Booking window is computed in the facility timezone (Asia/Manila) from the
-- existing booking's own date + start_time + duration_hours.
-- ---------------------------------------------------------------------------
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
  b as (
    select
      (bk.booking_date + bk.start_time) at time zone 'Asia/Manila' as start_ts,
      ((bk.booking_date + bk.start_time) at time zone 'Asia/Manila')
        + make_interval(hours => bk.duration_hours) as end_ts
    from public.bookings bk
    where bk.paddle_id = (select p.id from p)
      and bk.booking_date = (timezone('Asia/Manila', now()))::date
      and bk.status in ('upcoming', 'confirmed')
    order by bk.start_time
    limit 1
  )
  select
    p.id,
    p.paddle_number,
    p.name,
    p.is_active,
    case
      when not p.is_active then 'disabled'
      when b.start_ts is not null and now() < b.start_ts then 'reserved'
      when b.start_ts is not null and now() < b.end_ts then 'in_use'
      else 'available'
    end,
    b.start_ts,
    b.end_ts
  from p
  left join b on true;
$$;

-- Anonymous phone visitors and signed-in users can both scan/check paddles.
grant execute on function public.get_paddle_status(text) to anon, authenticated;