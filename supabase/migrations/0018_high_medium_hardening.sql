-- ============================================================================
-- 0018_high_medium_hardening.sql
-- Additive fixes from the High/Medium/Low audit pass:
--
--   H4 — get_paddle_status returned the renter's FULL name to anonymous
--        scanners. Now returns a first-name/initial only, so the public QR
--        page is useful ("In use — reserved by Juan") without exposing a
--        customer's full identity. (0010's own comment promised this.)
--
--   M8 — Admin DELETE on bookings/payments allowed irreversible loss of
--        financial records. Added soft-delete columns + RLS that hides
--        soft-deleted rows from every client, and revoked the hard-DELETE
--        policies from authenticated clients (service_role keeps full power).
--
--   M6 — normalize_mobile_digits only folded some PH forms. Tightened so
--        "+63-0917...", "63 (0)917...", "0063 ..." etc. all normalise to the
--        local "0917..." form, and fewer valid numbers slip through.
--
--   L1 — New paddles could get a predictable qr_token ("paddle-001"). Added a
--        random default at the database level so a QR token is unguessable even
--        if a client forgets to set one.
--
-- Everything here is additive; existing rows and the 2-court ₱300/hour design
-- are untouched.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- H4) Public paddle status: no full renter name.
--     Re-declares the RPC with the SAME shape EXCEPT rental_name is reduced to
--     the first token of the name (so the page still shows a friendly label).
-- ----------------------------------------------------------------------------
create or replace function public.get_paddle_status(
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
    -- H4: first name only (never the full name / email / phone).
    case
      when r.customer_name is null then null
      else split_part(btrim(r.customer_name), ' ', 1)
    end,
    r.booking_date,
    c.name
  from p
  left join relevant r on true
  left join public.courts c on c.id = r.court_id;
$$;

comment on function public.get_paddle_status(text, integer) is
  'Public paddle status for QR scans. Exposes ONLY paddle identity, availability and the rental window. The renter label is reduced to a FIRST NAME only — never a full name, email or phone.';

grant execute on function public.get_paddle_status(text, integer) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- M8) Soft-delete for bookings + payments.
--     A `deleted_at` marker keeps the row recoverable and audit-friendly.
--     Every existing client SELECT/UPDATE path stays valid because the helper
--     policies below hide soft-deleted rows; hard DELETE is removed from
--     authenticated clients (the service_role can still hard-delete for GDPR
--     erasure outside the app).
-- ----------------------------------------------------------------------------
alter table public.bookings add column if not exists deleted_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;

-- Replace the blanket admin DELETE policies with nothing for clients: deletes
-- now go through the soft-delete flag (UPDATE deleted_at).
drop policy if exists bookings_admin_delete_all on public.bookings;
drop policy if exists payments_admin_delete_all on public.payments;

-- Keep the existing admin SELECT/UPDATE policies but make them ignore
-- soft-deleted rows. The customer "own" policies also ignore them.
drop policy if exists bookings_select_own on public.bookings;
create policy bookings_select_own
  on public.bookings for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists bookings_admin_select_all on public.bookings;
create policy bookings_admin_select_all
  on public.bookings for select
  using (public.is_admin() and deleted_at is null);

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own
  on public.payments for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists payments_admin_select_all on public.payments;
create policy payments_admin_select_all
  on public.payments for select
  using (public.is_admin() and deleted_at is null);

-- A soft-deleted booking must not block the court for a new booking.
drop index if exists bookings_no_double_booking;
create unique index if not exists bookings_no_double_booking
  on public.bookings (court_id, booking_date, start_time)
  where status <> 'cancelled' and deleted_at is null;

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
  ) where (status <> 'cancelled' and deleted_at is null);

-- The public availability RPC must also skip soft-deleted rows.
create or replace function public.get_booked_slots(p_date date)
returns table (court_id uuid, start_time time)
language sql
security definer
set search_path = public
stable
as $$
  select b.court_id, (b.start_time + gs * interval '1 hour')::time
  from public.bookings b
  cross join lateral generate_series(0, b.duration_hours - 1) as gs
  where b.booking_date = p_date
    and b.status <> 'cancelled'
    and b.deleted_at is null
  order by b.start_time;
$$;

grant execute on function public.get_booked_slots(date) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- M6) Stricter PH mobile normalisation.
--     Folds +63 / 63 / 0063 / 63(0) and the local 0-prefixed form to a single
--     canonical "0XXXXXXXXXX". Non-matching input is returned as bare digits.
-- ----------------------------------------------------------------------------
create or replace function public.normalize_mobile_digits(p text)
returns text
language sql
immutable
as $$
  select case
    -- 0063 + 10 digits (optional stray 0 after the country code)
    when d ~ '^0063[0-9]{9,11}$' then '0' || ltrim(substring(d from 5), '0')
    -- 63 + 10 digits
    when d ~ '^63[0-9]{9,11}$'   then '0' || ltrim(substring(d from 3), '0')
    -- already local, with a leading 0
    when d ~ '^0[0-9]{9,11}$'    then d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s;
$$;

revoke all on function public.normalize_mobile_digits(text) from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- L1) Unguessable paddle QR tokens by default.
--     The column now has a random default, so a paddle created without an
--     explicit token still gets an unguessable one. The client no longer sets
--     a predictable "paddle-001" value (see paddleService.js).
-- ----------------------------------------------------------------------------
alter table public.paddles
  alter column qr_token set default replace(gen_random_uuid()::text, '-', '');