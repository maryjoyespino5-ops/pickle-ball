-- ============================================================================
-- 0017_critical_hardening.sql
-- Fixes for the CRITICAL audit findings C2 and C3.
--
--   C2 — Duration limit was only enforced for the GUEST flow
--        (create_guest_booking reads facility_settings.max_duration) and by the
--        column CHECK (duration_hours between 1 and 2). The SIGNED-IN flow
--        (bookingService.createBooking) and the ADMIN flow
--        (createAdminBooking) insert straight into public.bookings, so a
--        customer could book 2 hours even after the admin lowered
--        max_duration to 1. This adds ONE trigger that enforces the configured
--        maximum on every insert/update, for every caller, and keeps the
--        existing "end by closing time" rule consistent with it.
--
--   C3 — Booking references were sequential (RB-YYMMDD-NNN from
--        booking_number_seq), so an anonymous attacker could enumerate
--        references and brute-force the phone number to read other guests'
--        bookings via lookup_guest_booking / cancel_guest_booking_by_phone.
--        references now carry a random suffix (RB-YYMMDD-NNN-XXXX) that is
--        unguessable, while staying human-readable and unique.
--
-- Both changes are ADDITIVE: existing rows keep their current reference, the
-- 2-court / ₱300-per-hour pricing and every existing constraint are untouched.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- C2) Enforce facility max_duration on EVERY insert/update (all callers).
--     Replaces the guest-only check with a table trigger so the signed-in and
--     admin flows cannot exceed the configured maximum either.
-- ----------------------------------------------------------------------------
create or replace function public.assert_booking_duration()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
begin
  if new.duration_hours is null then
    return new;
  end if;

  select coalesce(fs.max_duration, 2)
    into v_max
  from public.facility_settings fs
  where fs.id = true;

  -- Fallback matches 0006's default seed so a half-provisioned database cannot
  -- accept an unbounded duration.
  v_max := coalesce(v_max, 2);

  if new.duration_hours < 1 or new.duration_hours > v_max then
    raise exception 'You can book between 1 and % hour(s) at a time.', v_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.assert_booking_duration() is
  'Rejects bookings whose duration_hours exceeds facility_settings.max_duration (1..max). Applies to every caller (customer, admin, guest) so lowering the maximum takes effect immediately.';

-- Trigger-only helper: revoke direct execution from every client role.
revoke all on function public.assert_booking_duration() from public, anon, authenticated;

drop trigger if exists bookings_assert_duration on public.bookings;
create trigger bookings_assert_duration
  before insert or update of duration_hours on public.bookings
  for each row execute function public.assert_booking_duration();


-- ----------------------------------------------------------------------------
-- C3) Unguessable booking references.
--     RB-YYMMDD-NNN-<4 random base32 chars>. Keeps the friendly date + sequence
--     prefix for humans/support, but the random suffix removes the enumeration
--     vector while the guest_token remains the real authorisation secret.
-- ----------------------------------------------------------------------------
create or replace function public.assign_booking_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Crockford-style alphabet: no I/L/O/U to avoid transcription confusion.
  alphabet text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  suffix   text := '';
  i        integer;
begin
  if new.booking_number is null then
    for i in 1..4 loop
      suffix := suffix
        || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    new.booking_number := 'RB-'
      || to_char(new.booking_date, 'YYMMDD')
      || '-'
      || lpad(nextval('public.booking_number_seq')::text, 3, '0')
      || '-'
      || suffix;
  end if;
  return new;
end;
$$;

comment on function public.assign_booking_number() is
  'Assigns a human-readable, non-enumerable booking reference: RB-YYMMDD-NNN-XXXX where XXXX is 4 random base32 characters. The random suffix defeats reference enumeration; the guest_token remains the real secret.';

-- The old unique constraint on booking_number still guarantees uniqueness; the
-- random suffix makes collisions vanishingly unlikely, and a collision would
-- simply raise unique_violation which the app already maps to a friendly error.

-- ----------------------------------------------------------------------------
-- C3b) Make create_guest_booking robust to the (now random) reference suffix.
--      Old behaviour: ANY unique_violation was reported as "already booked",
--      which was fine when the booking number was a pure sequence (only the
--      no-double-booking index could throw). With the random suffix a rare
--      reference collision could masquerade as a double-booking. This version
--      retries once on a reference collision and still reports a genuine
--      overlap (exclusion_violation) correctly. Everything else (validation,
--      pricing, overlap guard) is identical to 0015.
-- ----------------------------------------------------------------------------
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
  v_attempt integer := 0;
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

  -- Retry once on a booking_number collision (the reference now has a random
  -- suffix). A genuine overlap raises exclusion_violation and is reported as
  -- "already booked" without retrying.
  <<insert_attempt>>
  loop
    v_attempt := v_attempt + 1;
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
      exit insert_attempt;
    exception
      when exclusion_violation then
        raise exception 'That court is already booked for this time.';
      when unique_violation then
        -- booking_number collision (extremely unlikely) — retry once.
        if v_attempt >= 2 then
          raise exception 'We could not complete your booking. Please try again.';
        end if;
    end;
  end loop;

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

revoke all on function public.create_guest_booking(uuid, date, time, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_guest_booking(uuid, date, time, integer, text, text) to anon, authenticated;