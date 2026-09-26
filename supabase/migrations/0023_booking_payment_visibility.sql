-- ============================================================================
-- 0023_booking_payment_visibility.sql
--
-- Goal: a booking that is paid through PayMongo/GCash must read as
--       PAID + CONFIRMED in the PLAYER dashboard, the ADMIN dashboard, and for
--       guest (no-account) players — with no manual step.
--
-- confirm_booking_from_paymongo (0021) already commits
--     payments.status  = 'paid'
--     bookings.payment_status = 'paid'   (mirrored by the 0019 trigger)
--     bookings.status  = 'confirmed'
-- in ONE transaction, for registered and guest bookings alike.
--
-- What was still missing — and what this migration fixes:
--
--   G1) payments.user_id is NULL for guest bookings, and the customer-facing
--       policy is `auth.uid() = user_id`. A guest therefore cannot read their
--       own payment row. get_booking_payment_status() (0021) already covers the
--       payment step, but the confirmation page needs the PAYMENT METHOD and
--       reference too, so the RPCs below are extended to return them.
--
--   G2) payments has no `deleted_at` column, but the 0018 admin policy is
--       `is_admin() and deleted_at is null` — on a table without that column
--       the policy cannot be evaluated, which silently hides payment rows from
--       the admin Payments page. This migration adds the missing column so the
--       policy works as written and admin rows appear.
--
--   G3) The admin Bookings list resolves the customer from
--       `customer_name / profiles.full_name`. A confirmed guest booking has
--       customer_name set, but there was no server-side guarantee the guest's
--       PAID state was visible next to it. The admin RPC below returns the
--       booking's payment status/method/reference in one read, so the admin
--       table never has to join by hand.
--
--   G4) The guest confirmation page showed "Pay at court" hard-coded. The
--       extended get_guest_booking() returns payment_method + reference +
--       paid_at so the guest sees PAID + CONFIRMED for their own booking.
--
-- All additive. Pricing (₱300/hr), the 2-court design and "Pay at Court" are
-- untouched, and no client gains the ability to mark anything paid.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- G2) The missing column the 0018 admin policy already refers to.
--     Without this, `payments_admin_select_all ... using (is_admin() and
--     deleted_at is null)` errors/hides rows, so a confirmed booking's payment
--     was invisible to the admin Payments page.
-- ----------------------------------------------------------------------------
alter table public.payments
  add column if not exists deleted_at timestamptz;

comment on column public.payments.deleted_at is
  'Soft-delete flag. The 0018 admin SELECT policy filters on this column, so it must exist for admin payment lists and reconciliation to work.';

create index if not exists payments_not_deleted_idx
  on public.payments (created_at desc)
  where deleted_at is null;


-- ----------------------------------------------------------------------------
-- G1) Player-side status read, now including the payment METHOD and reference.
--     Authorises the signed-in owner OR the guest holding the booking token —
--     the same rule as 0021 — so both player types see PAID + CONFIRMED.
--     Read-only: this function can never settle a payment.
-- ----------------------------------------------------------------------------
create or replace function public.get_booking_payment_status(
  p_booking_number text,
  p_token text default null
)
returns table (
  booking_number text,
  booking_status text,
  payment_status text,
  amount numeric,
  payment_method text,
  reference text,
  paid_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.booking_number,
    b.status,
    b.payment_status,
    b.amount,
    p.method,
    coalesce(p.paymongo_reference, p.reference),
    coalesce(p.paymongo_paid_at, p.paid_at)
  from public.bookings b
  left join public.payments p on p.booking_id = b.id
  where b.booking_number = btrim(coalesce(p_booking_number, ''))
    and b.deleted_at is null
    and (
      -- the signed-in owner (registered player)
      b.user_id = auth.uid()
      -- or the guest holding the secure token for this exact booking
      or (p_token is not null
          and b.guest_token is not null
          and b.guest_token = btrim(p_token))
      -- or an admin, so the admin UI can reuse the same read
      or public.is_admin()
    )
  limit 1;
$$;

comment on function public.get_booking_payment_status(text, text) is
  'Read-only booking payment status for players (registered owner or guest token holder) and admins. Returns PAID + CONFIRMED state plus method/reference; never writes.';

revoke all on function public.get_booking_payment_status(text, text)
  from public, anon, authenticated;
grant execute on function public.get_booking_payment_status(text, text)
  to anon, authenticated;


-- ----------------------------------------------------------------------------
-- G4) Guest confirmation read, extended with the settled payment details.
--     get_guest_booking() is what the /booking/:reference page renders, so
--     adding payment_method / payment_reference / paid_at is what makes the
--     GUEST see PAID + CONFIRMED on their own page.
--
--     IMPORTANT: this changes the function's RETURN TYPE, and
--     `create or replace` cannot do that. Three other functions
--     (cancel_guest_booking, cancel_guest_booking_by_phone, claim_guest_booking)
--     are declared as `returns table (...)` mirroring this shape and end with
--     `return query select * from public.get_guest_booking(...)`, so they must
--     be dropped and recreated with the SAME new shape, in dependency order.
--     Between the drops and the recreates the grants are re-issued, so no
--     window exists where a guest flow is left unauthorised.
--
--     The `guest_token` output column is preserved as `null::text` exactly as
--     before: the secret is never returned. Everything else about the
--     authorisation is unchanged (token must match, row must not be deleted).
-- ----------------------------------------------------------------------------

-- Drop dependants first, then the function they select from.
drop function if exists public.claim_guest_booking(text, text);
drop function if exists public.cancel_guest_booking(text, text);
drop function if exists public.cancel_guest_booking_by_phone(text, text);
drop function if exists public.get_guest_booking(text, text);

create function public.get_guest_booking(
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
    p.method,
    coalesce(p.paymongo_reference, p.reference),
    coalesce(p.paymongo_paid_at, p.paid_at),
    b.customer_name,
    b.customer_phone,
    b.user_id is not null,
    b.created_at
  from public.bookings b
  join public.courts c on c.id = b.court_id
  left join public.payments p on p.booking_id = b.id
  where b.guest_token is not null
    and b.guest_token = btrim(coalesce(p_token, ''))
    and b.booking_number = btrim(coalesce(p_reference, ''))
    and b.deleted_at is null
  limit 1;
$$;

comment on function public.get_guest_booking(text, text) is
  'Guest-safe booking read via the secure token. Returns the settled payment method/reference/paid_at so a guest sees PAID + CONFIRMED after paying with GCash. The secret guest_token is never exposed.';

revoke all on function public.get_guest_booking(text, text)
  from public, anon, authenticated;
grant execute on function public.get_guest_booking(text, text)
  to anon, authenticated;


-- ----------------------------------------------------------------------------
-- G4b) Re-create the three dependants with the SAME widened shape, so their
--      `return query select * from public.get_guest_booking(...)` still binds.
--      Bodies are otherwise identical to 0015/0017.
-- ----------------------------------------------------------------------------
create function public.cancel_guest_booking(
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

comment on function public.cancel_guest_booking(text, text) is
  'Cancels a guest booking via the secure token and returns the updated row (now including settled payment details).';

revoke all on function public.cancel_guest_booking(text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_guest_booking(text, text)
  to anon, authenticated;


create function public.cancel_guest_booking_by_phone(
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
     and b.status in ('upcoming', 'confirmed')
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


create function public.claim_guest_booking(
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
  if auth.uid() is null then
    raise exception 'Sign in first to link this booking to your account.';
  end if;

  -- Attach the booking (and its payment row) to the signed-in account. The
  -- protect_booking_updates guard allows exactly this ownership claim.
  perform set_config('app.guest_booking_claim', 'on', true);

  update public.bookings b
     set user_id = auth.uid(),
         guest_token = null
   where b.booking_number = v_reference
     and b.guest_token = v_token
     and b.user_id is null
  returning b.id into v_id;

  perform set_config('app.guest_booking_claim', 'off', true);

  if v_id is null then
    raise exception 'We could not link that booking. It may already belong to an account.';
  end if;

  -- The payment row follows the booking so the customer can see it in
  -- Payments/My bookings; its user_id was NULL for the guest.
  update public.payments p
     set user_id = auth.uid()
   where p.booking_id = v_id
     and p.user_id is null;

  -- Re-read through the token path is no longer possible (guest_token cleared),
  -- so return the row directly in the same shape.
  return query
    select
      b.booking_number,
      null::text,
      c.name,
      b.booking_date,
      b.start_time,
      b.duration_hours,
      b.amount,
      b.status,
      b.payment_status,
      p.method,
      coalesce(p.paymongo_reference, p.reference),
      coalesce(p.paymongo_paid_at, p.paid_at),
      b.customer_name,
      b.customer_phone,
      b.user_id is not null,
      b.created_at
    from public.bookings b
    join public.courts c on c.id = b.court_id
    left join public.payments p on p.booking_id = b.id
    where b.id = v_id
    limit 1;
end;
$$;

comment on function public.claim_guest_booking(text, text) is
  'Links a guest booking (and its payment row) to the signed-in account and returns it, now including settled payment details.';

revoke all on function public.claim_guest_booking(text, text)
  from public, anon, authenticated;
grant execute on function public.claim_guest_booking(text, text)
  to authenticated;


-- ----------------------------------------------------------------------------
-- G3) Admin-side single read: booking + payment state in one row.
--     Lets the admin Bookings/Payments tables show PAID + CONFIRMED for BOTH
--     registered and guest bookings, with the customer resolved from
--     customer_name (guest) or profiles (account) and the method/reference for
--     support. Admin-only.
-- ----------------------------------------------------------------------------
create or replace function public.admin_booking_payment_overview(
  p_limit integer default 200,
  p_only_unpaid boolean default false
)
returns table (
  booking_number text,
  booking_status text,
  payment_status text,
  amount numeric,
  payment_method text,
  payment_reference text,
  paid_at timestamptz,
  court_name text,
  booking_date date,
  start_time time,
  duration_hours integer,
  customer_name text,
  customer_email text,
  customer_phone text,
  is_guest boolean,
  booking_created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.booking_number,
    b.status,
    b.payment_status,
    b.amount,
    p.method,
    coalesce(p.paymongo_reference, p.reference),
    coalesce(p.paymongo_paid_at, p.paid_at),
    c.name,
    b.booking_date,
    b.start_time,
    b.duration_hours,
    -- A guest books with their own details on the row; a registered player may
    -- fall back to their profile.
    coalesce(b.customer_name, pr.full_name),
    coalesce(b.customer_email, pr.email),
    coalesce(b.customer_phone, pr.phone),
    (b.user_id is null),
    b.created_at
  from public.bookings b
  left join public.courts c on c.id = b.court_id
  left join public.payments p on p.booking_id = b.id
  left join public.profiles pr on pr.id = b.user_id
  where b.deleted_at is null
    and public.is_admin()
    and (
      not p_only_unpaid
      or b.payment_status <> 'paid'
      or b.status <> 'confirmed'
    )
  order by b.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

comment on function public.admin_booking_payment_overview(integer, boolean) is
  'Admin-only: bookings with their PAID/CONFIRMED state, method, reference and customer details in one read. Covers guest and registered bookings; p_only_unpaid lists what still needs attention.';

revoke all on function public.admin_booking_payment_overview(integer, boolean)
  from public, anon;
grant execute on function public.admin_booking_payment_overview(integer, boolean)
  to authenticated;


-- ----------------------------------------------------------------------------
-- Backfill: any booking whose payment is already 'paid' but whose own
-- payment_status / status never caught up (the misrouted-webhook aftermath)
-- is brought into line here, so the dashboards agree immediately without
-- waiting for a manual reconciliation.
--
-- Deliberately conservative: it only acts on rows where the PAYMENT row says
-- paid, and it never touches a cancelled booking.
-- ----------------------------------------------------------------------------
do $$
declare
  v_fixed integer := 0;
begin
  perform set_config('app.internal_payment_sync', 'on', true);
  perform set_config('app.booking_server_confirm', 'on', true);

  update public.bookings b
     set payment_status = 'paid',
         status = case
           when b.status in ('upcoming', 'confirmed') then 'confirmed'
           else b.status
         end,
         updated_at = now()
   where b.deleted_at is null
     and b.status <> 'cancelled'
     and b.payment_status <> 'paid'
     and exists (
       select 1
       from public.payments p
       where p.booking_id = b.id
         and p.status = 'paid'
     );

  get diagnostics v_fixed = row_count;

  perform set_config('app.booking_server_confirm', 'off', true);
  perform set_config('app.internal_payment_sync', 'off', true);

  raise notice '0023: aligned % booking(s) whose payment row was already paid.', v_fixed;
end;
$$;