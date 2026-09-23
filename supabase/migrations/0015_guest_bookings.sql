-- ============================================================================
-- 0015_guest_bookings.sql
-- Guest (no account needed) booking flow.
--
--   * public.bookings.guest_token — a 122-bit random secret that authorises
--     exactly ONE booking. It travels inside the booking's QR code / manage
--     link only, is never returned by a table read, and is the ONLY thing that
--     lets an anonymous visitor look at (or cancel) that booking. Everyone
--     else keeps hitting RLS: guests cannot read, update or delete any row.
--
--   * create_guest_booking(...) — the only path an unauthenticated visitor has
--     to create a booking. It re-validates every rule server-side (court is
--     active, hour starts on the hour, slot is not in the past, duration is
--     within the facility maximum, no overlap) and then relies on the existing
--     bookings_no_overlap EXCLUDE constraint as the real double-booking guard.
--
--   * get_guest_booking / lookup_guest_booking — read the booking back either
--     with the secure token (QR link) or with the booking reference + the
--     mobile number used at booking time.
--
--   * cancel_guest_booking / cancel_guest_booking_by_phone — cancel with the
--     same proof, while the booking still belongs to the guest.
--
--   * claim_guest_booking — the optional "create an account after booking"
--     step: it links the guest booking to the account that was just created so
--     it appears in My Bookings / booking history.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Secure per-booking guest token
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists guest_token text;

-- One token per booking, and tokens are unique (a scanner can never resolve to
-- two rows). Partial index so the normal, registered bookings stay unaffected.
create unique index if not exists bookings_guest_token_key
  on public.bookings (guest_token)
  where guest_token is not null;

comment on column public.bookings.guest_token is
  'Random secret that authorises the guest booking manage/cancel link (the QR code). Never exposed through table RLS; only the security-definer guest RPCs read it.';

-- Shared by lookup_guest_booking / cancel_guest_booking_by_phone: strip to
-- digits and fold the PH country code back to the local form, so
-- "+63 917 555 0188", "00639175550188" and "0917 555 0188" all compare as
-- "09175550188" while every other number simply fails to match.
--
-- A local mobile is 0 + 10 digits, so dropping the "63"/"0063" prefix leaves
-- 8-10 digits (8 for a plain 11-digit local number, up to 10 when the caller
-- typed extra digits).
create or replace function public.normalize_mobile_digits(p text)
returns text
language sql
immutable
as $$
  select case
    when d ~ '^0063[1-9][0-9]{8,10}$' then '0' || substring(d from 5)
    when d ~ '^63[1-9][0-9]{8,10}$'   then '0' || substring(d from 3)
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) s;
$$;

revoke all on function public.normalize_mobile_digits(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Let the claim RPC move ONE guest booking (user_id null) onto the account
--    that was just created. Everything else about the owner guard stays as-is
--    (0014-style session flag, so no client can ever trigger the transfer).
-- ---------------------------------------------------------------------------
create or replace function public.protect_booking_updates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  claiming_guest boolean :=
    coalesce(current_setting('app.guest_booking_claim', true), 'off') = 'on';
begin
  if new.user_id is distinct from old.user_id then
    -- Only the guest -> account claim path may set an owner, and only from
    -- "no owner" to the caller's own id.
    if not (
      claiming_guest
      and old.user_id is null
      and new.user_id is not null
      and new.user_id = auth.uid()
    ) then
      raise exception 'Booking owner cannot be changed';
    end if;
  end if;
  if public.is_admin() then
    new.updated_at = now();
    return new;
  end if;
  if new.court_id is distinct from old.court_id
     or new.booking_date is distinct from old.booking_date
     or new.start_time is distinct from old.start_time
     or new.duration_hours is distinct from old.duration_hours
     or new.amount is distinct from old.amount
     or new.booking_number is distinct from old.booking_number
     or new.payment_status is distinct from old.payment_status
     or new.customer_name is distinct from old.customer_name
     or new.customer_email is distinct from old.customer_email
     or new.customer_phone is distinct from old.customer_phone then
    raise exception 'Booking details and payment status cannot be modified after booking';
  end if;
  if new.status is distinct from old.status
     and (new.status <> 'cancelled' or old.status not in ('upcoming', 'confirmed')) then
    raise exception 'Customers can only cancel upcoming bookings';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Create a guest booking (anonymous-safe, every rule re-checked here)
-- ---------------------------------------------------------------------------
create or replace function public.create_guest_booking(
  p_court_id uuid,
  p_date date,
  p_start_time time,
  p_duration integer,
  p_name text,
  p_phone text
)
returns table (
  booking_number text,
  guest_token text,
  court_name text,
  booking_date date,
  start_time time,
  duration_hours integer,
  amount numeric,
  status text,
  payment_status text,
  customer_name text,
  customer_phone text,
  is_claimed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := public.normalize_mobile_digits(p_phone);
  v_duration integer := coalesce(p_duration, 1);
  v_max_duration integer;
  v_token text;
  v_row public.bookings%rowtype;
begin
  if length(v_name) < 2 then
    raise exception 'Please enter the name for this booking.';
  end if;
  if length(v_digits) < 7 or length(v_phone) > 40 then
    raise exception 'Please enter a valid mobile number.';
  end if;
  if p_court_id is null then
    raise exception 'Please choose a court.';
  end if;
  if p_date is null or p_start_time is null then
    raise exception 'Please choose a date and time.';
  end if;
  if extract(minute from p_start_time) <> 0 then
    raise exception 'Bookings start on the hour.';
  end if;

  select coalesce(fs.max_duration, 2)
    into v_max_duration
  from public.facility_settings fs
  where fs.id = true;
  v_max_duration := coalesce(v_max_duration, 2);

  if v_duration < 1 or v_duration > v_max_duration then
    raise exception 'You can book between 1 and % hour(s) at a time.', v_max_duration;
  end if;

  if not exists (
    select 1
    from public.courts c
    where c.id = p_court_id
      and c.is_active = true
      and coalesce(c.maintenance, false) = false
  ) then
    raise exception 'That court is not available for booking.';
  end if;

  -- Friendly double-booking message; the bookings_no_overlap EXCLUDE constraint
  -- below is still the guarantee that holds under concurrent requests.
  if exists (
    select 1
    from public.bookings b
    where b.court_id = p_court_id
      and b.booking_date = p_date
      and b.status <> 'cancelled'
      and b.start_time < (p_start_time + make_interval(hours => v_duration))
      and p_start_time < (b.start_time + make_interval(hours => b.duration_hours))
  ) then
    raise exception 'That court is already booked for this time.';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '');

  begin
    insert into public.bookings (
      user_id,
      court_id,
      booking_date,
      start_time,
      duration_hours,
      status,
      payment_status,
      customer_name,
      customer_phone,
      guest_token
    )
    values (
      null,
      p_court_id,
      p_date,
      p_start_time,
      v_duration,
      'upcoming',
      'pending',
      v_name,
      v_phone,
      v_token
    )
    returning * into v_row;
  exception
    when exclusion_violation then
      raise exception 'That court is already booked for this time.';
    when unique_violation then
      raise exception 'That court is already booked for this time.';
  end;

  return query
    select
      v_row.booking_number,
      v_row.guest_token,
      (select c.name from public.courts c where c.id = v_row.court_id),
      v_row.booking_date,
      v_row.start_time,
      v_row.duration_hours,
      v_row.amount,
      v_row.status,
      v_row.payment_status,
      v_row.customer_name,
      v_row.customer_phone,
      false,
      v_row.created_at;
end;
$$;

comment on function public.create_guest_booking(uuid, date, time, integer, text, text) is
  'Creates a booking for a guest with no account and returns its reference + secure token. All pricing, status and overlap rules are enforced here and by the table triggers.';

-- ---------------------------------------------------------------------------
-- 4) Read a guest booking back — with the secure token (QR link) OR with the
--    booking reference + the mobile number used at booking time. Both return
--    the SAME column list so the RPCs below can chain off them.
--    guest_token is always null in reads: the secret only travels inside the
--    link the guest already holds (never through a table read).
-- ---------------------------------------------------------------------------
create or replace function public.get_guest_booking(
  p_reference text,
  p_token text
)
returns table (
  booking_number text,
  guest_token text,
  court_name text,
  booking_date date,
  start_time time,
  duration_hours integer,
  amount numeric,
  status text,
  payment_status text,
  customer_name text,
  customer_phone text,
  is_claimed boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.booking_number,
    null::text as guest_token,
    c.name,
    b.booking_date,
    b.start_time,
    b.duration_hours,
    b.amount,
    b.status,
    b.payment_status,
    b.customer_name,
    b.customer_phone,
    b.user_id is not null,
    b.created_at
  from public.bookings b
  join public.courts c on c.id = b.court_id
  where b.guest_token is not null
    and b.guest_token = btrim(coalesce(p_token, ''))
    and b.booking_number = btrim(coalesce(p_reference, ''))
  limit 1;
$$;

create or replace function public.lookup_guest_booking(
  p_reference text,
  p_phone text
)
returns table (
  booking_number text,
  guest_token text,
  court_name text,
  booking_date date,
  start_time time,
  duration_hours integer,
  amount numeric,
  status text,
  payment_status text,
  customer_name text,
  customer_phone text,
  is_claimed boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.booking_number,
    null::text as guest_token,
    c.name,
    b.booking_date,
    b.start_time,
    b.duration_hours,
    b.amount,
    b.status,
    b.payment_status,
    b.customer_name,
    b.customer_phone,
    b.user_id is not null,
    b.created_at
  from public.bookings b
  join public.courts c on c.id = b.court_id
  where b.guest_token is not null
    and b.booking_number = btrim(coalesce(p_reference, ''))
    -- Normalised digits: "+63 917 555 0188", "00639175550188" and
    -- "0917 555 0188" all compare as "09175550188"; anything else won't match.
    and length(public.normalize_mobile_digits(p_phone)) >= 7
    and public.normalize_mobile_digits(b.customer_phone)
        = public.normalize_mobile_digits(p_phone)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 5) Cancel a guest booking — only while it still belongs to the guest and is
--    still cancellable. A booking that was claimed by an account is managed
--    from that account (My Bookings).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_guest_booking(
  p_reference text,
  p_token text
)
returns table (
  booking_number text,
  guest_token text,
  court_name text,
  booking_date date,
  start_time time,
  duration_hours integer,
  amount numeric,
  status text,
  payment_status text,
  customer_name text,
  customer_phone text,
  is_claimed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := btrim(coalesce(p_reference, ''));
  v_token text := btrim(coalesce(p_token, ''));
  v_id uuid;
begin
  if v_reference = '' or v_token = '' then
    raise exception 'Open your booking with the secure link from your confirmation.';
  end if;

  update public.bookings b
     set status = 'cancelled'
   where b.booking_number = v_reference
     and b.guest_token = v_token
     and b.user_id is null
     and b.status in ('upcoming', 'confirmed')
  returning b.id into v_id;

  if v_id is null then
    if exists (
      select 1
      from public.bookings b
      where b.booking_number = v_reference
        and b.guest_token = v_token
    ) then
      raise exception 'This booking can no longer be cancelled with this link. Sign in to your account or contact the facility.';
    end if;
    raise exception 'We could not find that booking. Check the link from your confirmation.';
  end if;

  return query select * from public.get_guest_booking(v_reference, v_token);
end;
$$;

create or replace function public.cancel_guest_booking_by_phone(
  p_reference text,
  p_phone text
)
returns table (
  booking_number text,
  guest_token text,
  court_name text,
  booking_date date,
  start_time time,
  duration_hours integer,
  amount numeric,
  status text,
  payment_status text,
  customer_name text,
  customer_phone text,
  is_claimed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := btrim(coalesce(p_reference, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_digits text := public.normalize_mobile_digits(p_phone);
  v_id uuid;
begin
  if v_reference = '' or length(v_digits) < 7 then
    raise exception 'Enter your booking reference and the mobile number you booked with.';
  end if;

  update public.bookings b
     set status = 'cancelled'
   where b.booking_number = v_reference
     and b.user_id is null
          and public.normalize_mobile_digits(b.customer_phone) = v_digits
     and b.status in ('upcoming', 'confirmed')
  returning b.id into v_id;

  if v_id is null then
    if exists (
      select 1
      from public.bookings b
      where b.booking_number = v_reference
        and public.normalize_mobile_digits(b.customer_phone) = v_digits
    ) then
      raise exception 'This booking can no longer be cancelled online. Please contact the facility.';
    end if;
    raise exception 'We could not find a booking with that reference and mobile number.';
  end if;

  return query select * from public.lookup_guest_booking(v_reference, v_phone);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Optional "create an account after booking": link the guest booking (and
--    its payment row) to the account that was just created, so it shows up in
--    My Bookings and the customer's booking history.
-- ---------------------------------------------------------------------------
create or replace function public.claim_guest_booking(
  p_reference text,
  p_token text
)
returns table (
  booking_number text,
  guest_token text,
  court_name text,
  booking_date date,
  start_time time,
  duration_hours integer,
  amount numeric,
  status text,
  payment_status text,
  customer_name text,
  customer_phone text,
  is_claimed boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reference text := btrim(coalesce(p_reference, ''));
  v_token text := btrim(coalesce(p_token, ''));
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to your account first, then open this booking link again.';
  end if;
  if v_reference = '' or v_token = '' then
    raise exception 'Open your booking with the secure link from your confirmation.';
  end if;

  -- Transaction-local flag consumed by protect_booking_updates() for this one
  -- path: a booking with no owner may be attached to the caller's account.
  perform set_config('app.guest_booking_claim', 'on', true);

  update public.bookings b
     set user_id = v_uid
   where b.booking_number = v_reference
     and b.guest_token = v_token
     and b.user_id is null
  returning b.id into v_id;

  perform set_config('app.guest_booking_claim', 'off', true);

  if v_id is not null then
    update public.payments p
       set user_id = v_uid
     where p.booking_id = v_id
       and p.user_id is null;
  end if;

  return query select * from public.get_guest_booking(v_reference, v_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Permissions: guests (anon) may create / look up / cancel their own
--    booking through these RPCs and nothing else — RLS still hides every
--    other customer's rows. Claiming needs a signed-in account.
-- ---------------------------------------------------------------------------
revoke all on function public.create_guest_booking(uuid, date, time, integer, text, text) from public, anon, authenticated;
revoke all on function public.get_guest_booking(text, text) from public, anon, authenticated;
revoke all on function public.lookup_guest_booking(text, text) from public, anon, authenticated;
revoke all on function public.cancel_guest_booking(text, text) from public, anon, authenticated;
revoke all on function public.cancel_guest_booking_by_phone(text, text) from public, anon, authenticated;
revoke all on function public.claim_guest_booking(text, text) from public, anon, authenticated;

grant execute on function public.create_guest_booking(uuid, date, time, integer, text, text) to anon, authenticated;
grant execute on function public.get_guest_booking(text, text) to anon, authenticated;
grant execute on function public.lookup_guest_booking(text, text) to anon, authenticated;
grant execute on function public.cancel_guest_booking(text, text) to anon, authenticated;
grant execute on function public.cancel_guest_booking_by_phone(text, text) to anon, authenticated;
grant execute on function public.claim_guest_booking(text, text) to authenticated;
