-- ============================================================================
-- 0003_bookings.sql
-- Bookings table with:
--   * DB-level double-booking prevention (partial unique index)
--   * amount computed from the court price (never trusted from the client)
--   * friendly RB-YYMMDD-NNN booking numbers
--   * RLS: customers see/create/cancel only their own bookings
-- ============================================================================

create sequence if not exists public.booking_number_seq;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_number text not null unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete restrict,
  booking_date date not null,
  start_time time not null check (
    start_time >= time '07:00'
    and start_time <= time '21:00'
    and extract(minute from start_time) = 0
  ),
  duration_hours integer not null default 1 check (duration_hours between 1 and 2),
  amount numeric not null check (amount >= 0),
  status text not null default 'upcoming'
    check (status in ('upcoming', 'confirmed', 'completed', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Friendly booking number, e.g. RB-260918-001.
create or replace function public.assign_booking_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_number is null then
    new.booking_number := 'RB-'
      || to_char(new.booking_date, 'YYMMDD')
      || '-'
      || lpad(nextval('public.booking_number_seq')::text, 3, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_assign_number on public.bookings;
create trigger bookings_assign_number
  before insert on public.bookings
  for each row execute function public.assign_booking_number();

-- Amount is always derived from the court price at the database level.
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
  if not court_row.is_active then
    raise exception 'Court is not available for booking';
  end if;
  new.amount := court_row.price_per_hour * new.duration_hours;
  return new;
end;
$$;

drop trigger if exists bookings_set_amount on public.bookings;
create trigger bookings_set_amount
  before insert on public.bookings
  for each row execute function public.set_booking_amount();

-- Double-booking prevention at the database level: no two non-cancelled
-- bookings may share the same court/date/start time.
create unique index if not exists bookings_no_double_booking
  on public.bookings (court_id, booking_date, start_time)
  where status <> 'cancelled';

-- Customers can cancel eligible upcoming bookings, but cannot touch
-- court/slot/payment details or payment status.
create or replace function public.protect_booking_updates()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.court_id is distinct from old.court_id
     or new.booking_date is distinct from old.booking_date
     or new.start_time is distinct from old.start_time
     or new.duration_hours is distinct from old.duration_hours
     or new.amount is distinct from old.amount
     or new.booking_number is distinct from old.booking_number
     or new.payment_status is distinct from old.payment_status then
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

drop trigger if exists bookings_protect_updates on public.bookings;
create trigger bookings_protect_updates
  before update on public.bookings
  for each row execute function public.protect_booking_updates();

-- RLS: customers can only see / create / cancel their own bookings.
alter table public.bookings enable row level security;

drop policy if exists "bookings_select_own" on public.bookings;
create policy "bookings_select_own"
  on public.bookings for select
  using (auth.uid() = user_id);

drop policy if exists "bookings_insert_own" on public.bookings;
create policy "bookings_insert_own"
  on public.bookings for insert
  with check (
    auth.uid() = user_id
    and status = 'upcoming'
    and payment_status = 'pending'
  );

drop policy if exists "bookings_update_own" on public.bookings;
create policy "bookings_update_own"
  on public.bookings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);