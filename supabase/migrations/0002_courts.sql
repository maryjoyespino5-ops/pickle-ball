-- ============================================================================
-- 0002_courts.sql
-- Courts table + seed of exactly two courts at ₱300/hour.
-- Customers can only view *active* courts.
-- ============================================================================

create table if not exists public.courts (
  id uuid primary key,
  name text not null unique,
  description text,
  accent text not null default 'sunset',
  price_per_hour numeric not null default 300 check (price_per_hour > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.courts enable row level security;

-- Customers can only see active courts.
drop policy if exists "courts_select_active" on public.courts;
create policy "courts_select_active"
  on public.courts for select
  using (is_active = true);

-- No insert / update / delete policies -> only the service role (admin/server)
-- can manage courts. Exactly two courts, both at ₱300/hour.
insert into public.courts (id, name, description, accent, price_per_hour)
values
  (
    '00000000-0000-0000-0000-000000000001',
    'Court 1',
    'Bright, open-air court with a cushioned surface.',
    'sunset',
    300
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'Court 2',
    'Quiet second court for focused rallies and doubles.',
    'mint',
    300
  )
on conflict (id) do nothing;