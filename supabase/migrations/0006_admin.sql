-- ============================================================================
-- 0006_admin.sql
-- Admin role detection, admin RLS policies, overlap prevention, and the extra
-- fields/tables the admin UI needs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Admin detection function (security definer so RLS can call it)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Extra columns used by the admin UI
-- ---------------------------------------------------------------------------
alter table public.courts
  add column if not exists maintenance boolean not null default false,
  add column if not exists image text;

alter table public.bookings
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text;

-- ---------------------------------------------------------------------------
-- 3) Customers can only see active courts that are NOT under maintenance.
-- ---------------------------------------------------------------------------
drop policy if exists "courts_select_active" on public.courts;
create policy "courts_select_active"
  on public.courts for select
  using (is_active = true and coalesce(maintenance, false) = false);

-- ---------------------------------------------------------------------------
-- 4) Database-level overlap prevention (handles 1h and 2h bookings)
-- ---------------------------------------------------------------------------
create extension if not exists btree_gist;

alter table public.bookings
  drop constraint if exists bookings_no_overlap;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    court_id with =,
    booking_date with =,
    tsrange(
      booking_date + start_time,
      booking_date + start_time + duration_hours * interval '1 hour'
    ) with &&
  ) where (status <> 'cancelled');
-- ---------------------------------------------------------------------------
-- 5) Admin RLS policies
-- ---------------------------------------------------------------------------
-- Profiles: admins can read (and update) profiles; the role-guard trigger
-- still prevents ANY role change (admin included).
drop policy if exists "profiles_admin_select_all" on public.profiles;
create policy "profiles_admin_select_all"
  on public.profiles for select
  using (public.is_admin());

-- Courts: admins can fully manage court records.
drop policy if exists "courts_admin_all" on public.courts;
create policy "courts_admin_all"
  on public.courts for all
  using (public.is_admin())
  with check (public.is_admin());

-- Bookings: admins can read / create / update any booking.
drop policy if exists "bookings_admin_select_all" on public.bookings;
create policy "bookings_admin_select_all"
  on public.bookings for select
  using (public.is_admin());

drop policy if exists "bookings_admin_insert" on public.bookings;
create policy "bookings_admin_insert"
  on public.bookings for insert
  with check (public.is_admin());

drop policy if exists "bookings_admin_update_all" on public.bookings;
create policy "bookings_admin_update_all"
  on public.bookings for update
  using (public.is_admin())
  with check (public.is_admin());

-- Payments: admins can read and update payment status.
drop policy if exists "payments_admin_select_all" on public.payments;
create policy "payments_admin_select_all"
  on public.payments for select
  using (public.is_admin());

drop policy if exists "payments_admin_update_all" on public.payments;
create policy "payments_admin_update_all"
  on public.payments for update
  using (public.is_admin())
  with check (public.is_admin());
-- ---------------------------------------------------------------------------
-- 6) Booking triggers: admins may reschedule/change status/payment;
--    customers keep the "only cancel upcoming" rule.
-- ---------------------------------------------------------------------------
create or replace function public.set_booking_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row public.courts%rowtype;
begin
  select * into court_row from public.courts where id = new.court_id;
  if court_row.id is null then
    raise exception 'Court % does not exist', new.court_id;
  end if;
  if not court_row.is_active or court_row.maintenance then
    raise exception 'Court is not available for booking';
  end if;
  new.amount := court_row.price_per_hour * new.duration_hours;
  -- Snapshot the customer when the caller did not provide one.
  if new.customer_name is null then
    select p.full_name, p.email, p.phone
      into new.customer_name, new.customer_email, new.customer_phone
    from public.profiles p
    where p.id = new.user_id;
  end if;
  return new;
end;
$$;

create or replace function public.protect_booking_updates()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Booking owner cannot be changed';
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
-- 7) Multi-hour aware availability used by the public page.
-- ---------------------------------------------------------------------------
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
  order by b.start_time;
$$;

grant execute on function public.get_booked_slots(date) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) Facility settings (admin-only).
-- ---------------------------------------------------------------------------
create table if not exists public.facility_settings (
  id boolean primary key default true check (id),
  facility_name text not null default 'Rally Court Club',
  address text not null default '18 Palm Avenue, Makati, Metro Manila',
  contact text not null default '+63 917 555 0188',
  facility_email text not null default 'hello@rallycourt.ph',
  opening_time time not null default '07:00',
  closing_time time not null default '22:00',
  default_duration integer not null default 1,
  max_duration integer not null default 2,
  updated_at timestamptz not null default now()
);

insert into public.facility_settings
  (facility_name, address, contact, facility_email, opening_time, closing_time, default_duration, max_duration)
values
  ('Rally Court Club', '18 Palm Avenue, Makati, Metro Manila', '+63 917 555 0188', 'hello@rallycourt.ph', '07:00', '22:00', 1, 2)
on conflict (id) do nothing;

alter table public.facility_settings enable row level security;

drop policy if exists "facility_settings_admin_select" on public.facility_settings;
create policy "facility_settings_admin_select"
  on public.facility_settings for select
  using (public.is_admin());

drop policy if exists "facility_settings_admin_update" on public.facility_settings;
create policy "facility_settings_admin_update"
  on public.facility_settings for update
  using (public.is_admin())
  with check (public.is_admin());