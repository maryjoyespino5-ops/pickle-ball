-- ============================================================================
-- 0004_payments.sql
-- Payments table. Customers can only *view* their own payments and can never
-- modify payment status (no insert/update/delete policies are granted).
-- ============================================================================

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric not null check (amount >= 0),
  method text not null default 'Pay at Court',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'refunded')),
  reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.payments enable row level security;

-- Customers can only see their own payment information.
drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own"
  on public.payments for select
  using (auth.uid() = user_id);

-- Intentionally no insert / update / delete policies:
-- customers cannot create or change payment status. Only the service role
-- (admin/server endpoints) manages payments.

-- Auto-create a payment row whenever a booking is created so customers have
-- a payment record to view.
create or replace function public.handle_new_booking_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payments (booking_id, user_id, amount, method, status)
  values (new.id, new.user_id, new.amount, 'Pay at Court', new.payment_status)
  on conflict (booking_id) do nothing;
  return new;
end;
$$;

drop trigger if exists bookings_create_payment on public.bookings;
create trigger bookings_create_payment
  after insert on public.bookings
  for each row execute function public.handle_new_booking_payment();