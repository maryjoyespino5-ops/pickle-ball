-- ============================================================================
-- 0026_pending_status_followups.sql
--
-- 0024 renamed the OPEN booking status from 'upcoming' to 'pending' — the CHECK
-- constraint, the column default, the data pass and the update guard — and the
-- client followed. Four database objects were left on the old vocabulary:
--
--   1. RLS policy bookings_insert_own (0003)
--        with check (auth.uid() = user_id
--                    and status = 'upcoming'
--                    and payment_status = 'pending')
--      A new booking is now 'pending' (the column default) and 'upcoming' is
--      rejected by the CHECK constraint, so this policy could never be
--      satisfied. EVERY signed-in insert failed with
--
--          42501: new row violates row-level security policy for table "bookings"
--
--      which is the booking failure this migration repairs. The policy keeps
--      its original intent: a customer may only create a fresh, unpaid booking
--      for themselves — never one that is already confirmed/completed/paid.
--      Guests are unaffected (create_guest_booking is SECURITY DEFINER) and an
--      admin insert is covered by bookings_admin_insert from 0006.
--
--   2. create_guest_booking (0017) inserted the literal 'upcoming', which the
--      tightened CHECK now rejects with 23514 — so guest booking was broken too
--      while the signed-in failure masked it.
--
--   3. get_paddle_status (0018) only looked at ('upcoming','confirmed'), so a
--      paddle linked to a pending booking never showed as Reserved / In Use.
--
--   4. cancel_guest_booking and cancel_guest_booking_by_phone (both last
--      redefined in 0023) only cancelled a booking whose status was
--      ('upcoming','confirmed'), so every guest self-cancel reported
--      "we could not find a booking...".
--
-- Everything else is untouched: same argument names, same return shapes, same
-- grants, same pricing, same overlap/past-slot rules.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) The fix: let a customer create their own PENDING, unpaid booking again.
-- ----------------------------------------------------------------------------
drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
  on public.bookings for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and payment_status = 'pending'
  );


-- ----------------------------------------------------------------------------
-- 2) Guest booking: insert the current open status.
--    (Body identical to 0017 apart from 'upcoming' -> 'pending'.)
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
  -- is still the guarantee that holds under concurrent requests.
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

  -- Retry once on a booking_number collision (the reference carries a random
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
        'pending',
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

comment on function public.create_guest_booking(uuid, date, time, integer, text, text) is
  'Anonymous booking entry point: validates the request, computes the amount server-side and creates a PENDING/unpaid booking with a secret guest token for follow-up.';

revoke all on function public.create_guest_booking(uuid, date, time, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.create_guest_booking(uuid, date, time, integer, text, text)
  to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3) Paddle QR status: a pending booking reserves/in-uses the paddle exactly
--    like a confirmed one. (Body identical to 0018 with the status list fixed.)
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
      and bk.status in ('pending', 'confirmed')
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
-- 4) Guest self-cancel: 'pending' bookings are cancellable too.
--    (Bodies identical to 0023 with the status list fixed.)
-- ----------------------------------------------------------------------------
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
  payment_method text,
  payment_reference text,
  paid_at timestamptz,
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
     and b.status in ('pending', 'confirmed')
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

comment on function public.cancel_guest_booking(text, text) is
  'Cancels a guest booking via the secure token and returns the updated row (now including settled payment details).';

revoke all on function public.cancel_guest_booking(text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_guest_booking(text, text)
  to anon, authenticated;


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
  payment_method text,
  payment_reference text,
  paid_at timestamptz,
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
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_id uuid;
begin
  if v_reference = '' or v_phone = '' then
    raise exception 'Enter your booking reference and the mobile number you booked with.';
  end if;

  update public.bookings b
     set status = 'cancelled'
   where b.booking_number = v_reference
     and b.user_id is null
     and b.guest_token is not null
     and regexp_replace(coalesce(b.customer_phone, ''), '[^0-9]', '', 'g') = v_phone
     and b.status in ('pending', 'confirmed')
  returning b.id into v_id;

  if v_id is null then
    -- Deliberately vague: never confirm which part did not match.
    raise exception 'We could not find a booking with that reference and mobile number.';
  end if;

  return query
    select *
    from public.get_guest_booking(
      v_reference,
      (select b.guest_token from public.bookings b where b.id = v_id)
    );
end;
$$;

comment on function public.cancel_guest_booking_by_phone(text, text) is
  'Cancels a guest booking after recovery by reference + phone, then returns the updated row (now including settled payment details).';

revoke all on function public.cancel_guest_booking_by_phone(text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_guest_booking_by_phone(text, text)
  to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 5) Self-check: fail loudly (rolling the whole migration back) if any object
--    above still advertises the retired status, so a silent no-op can never
--    ship again.
-- ----------------------------------------------------------------------------
do $$
declare
  v_policy text;
  v_functions text;
begin
  select with_check into v_policy
  from pg_policies
  where schemaname = 'public'
    and tablename = 'bookings'
    and policyname = 'bookings_insert_own';

  if v_policy is null then
    raise exception '0026: bookings_insert_own is missing.';
  end if;
  if v_policy like '%''upcoming''%' or v_policy not like '%''pending''%' then
    raise exception '0026: bookings_insert_own was not updated (with_check = %).', v_policy;
  end if;

  select string_agg(p.proname, ', ' order by p.proname) into v_functions
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'create_guest_booking',
      'get_paddle_status',
      'cancel_guest_booking',
      'cancel_guest_booking_by_phone'
    )
    and pg_get_functiondef(p.oid) like '%''upcoming''%';

  if v_functions is not null then
    raise exception '0026: these functions still reference the retired status: %', v_functions;
  end if;

  raise notice '0026: verified — bookings_insert_own allows pending inserts and no booking RPC references upcoming.';
end;
$$;



