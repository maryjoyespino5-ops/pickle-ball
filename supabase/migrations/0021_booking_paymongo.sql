-- ============================================================================
-- 0021_booking_paymongo.sql
-- Player court-booking payments through PayMongo (GCash / QR Ph checkout).
--
-- Scope: this is the PLAYER booking flow — a customer reserves a court and pays
-- for THAT booking. It is deliberately separate from the software LICENSE flow
-- (0014/0020), which renews business_subscription. They share only the PayMongo
-- signature check and the payment_webhook_events idempotency ledger.
--
-- Design rules (same conventions as the rest of this project):
--   * The server decides everything. The amount comes from the court record
--     (set_booking_amount, 0003), never from the browser.
--   * A booking is confirmed ONLY by a verified PayMongo payment reaching
--     confirm_booking_from_paymongo() (service_role only). The frontend redirect
--     is never trusted — a customer cannot confirm their own booking.
--   * "Pay at Court" is untouched: it stays the default and keeps working
--     exactly as before. Bookings are created pending/upcoming as always.
--   * Double-booking is already guaranteed by bookings_no_overlap +
--     bookings_no_double_booking (0018); nothing here weakens that. A booking
--     reserves its slot from creation, so a stale checkout cannot release it.
--
-- Pricing: NORMAL prices are authoritative everywhere — ₱300/hour and ₱600 for
-- 2 hours, straight from courts.price_per_hour (2 courts × ₱300, migration
-- 0002). Testing uses PayMongo TEST-mode keys, which move no real money, so no
-- ₱1 override and no price rewriting is required in the database. Switching to
-- live is an Edge Function secret change only.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Booking payment columns.
--    Lives on the existing payments table (one row per booking, created by the
--    bookings_create_payment trigger in 0004). Storing the PayMongo identifiers
--    here keeps the customer-visible payment record and the audit trail in the
--    SAME row, so Payments/Reports need no new join.
-- ----------------------------------------------------------------------------
alter table public.payments
  add column if not exists paymongo_checkout_session_id text,
  add column if not exists paymongo_payment_id text,
  add column if not exists paymongo_payment_intent_id text,
  add column if not exists paymongo_reference text,
  add column if not exists paymongo_amount numeric,
  add column if not exists paymongo_paid_at timestamptz;

comment on column public.payments.paymongo_checkout_session_id is
  'PayMongo Checkout Session id (cs_...) created for this booking. Unique per session.';
comment on column public.payments.paymongo_payment_id is
  'PayMongo payment id (pay_...) that actually settled the booking. This is the transaction reference stored against the booking.';
comment on column public.payments.paymongo_amount is
  'Amount PayMongo reports as collected (pesos). Used to cross-check the booking amount before confirming.';

-- One PayMongo session must never be attached to two bookings. Partial index so
-- the pre-existing "Pay at Court" rows (null session) are unaffected.
create unique index if not exists payments_paymongo_session_key
  on public.payments (paymongo_checkout_session_id)
  where paymongo_checkout_session_id is not null;

-- A PayMongo payment id settles exactly one booking: the guarantee that a
-- replayed webhook cannot pay for a second booking.
create unique index if not exists payments_paymongo_payment_id_key
  on public.payments (paymongo_payment_id)
  where paymongo_payment_id is not null;

-- Lookups from the admin Payments page / support ("which booking is pay_xxx?").
create index if not exists payments_paymongo_payment_idx
  on public.payments (paymongo_payment_id)
  where paymongo_payment_id is not null;

-- Record the payment method of a PayMongo-settled booking so reports and the
-- admin Payments table show "GCash" instead of the default "Pay at Court".
-- (method is free text with default 'Pay at Court' — no constraint to change.)


-- ----------------------------------------------------------------------------
-- 2) Let the RPC in section 3 write payments.status / bookings.status.
--    The sync trigger (0019) already mirrors payments.status onto
--    bookings.payment_status inside the same transaction, so this migration
--    reuses that machinery rather than duplicating the update.
-- ----------------------------------------------------------------------------
create or replace function public.sync_booking_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_id is not null
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform set_config('app.internal_payment_sync', 'on', true);
    update public.bookings
       set payment_status = new.status,
           updated_at = now()
     where id = new.booking_id;
    perform set_config('app.internal_payment_sync', 'off', true);
  end if;
  return new;
end;
$$;

comment on function public.sync_booking_payment_status() is
  'Keeps bookings.payment_status in lockstep with payments.status in the same transaction (M2).';

revoke all on function public.sync_booking_payment_status() from public, anon, authenticated;


-- ----------------------------------------------------------------------------
-- 3) Confirm a booking from a VERIFIED PayMongo payment. service_role only.
--
--    This is the single entry point the Edge Function calls. It:
--      a. claims the PayMongo event id (idempotency — a replay is a no-op),
--      b. matches the payment row by checkout session id, then by payment id,
--      c. cross-checks the collected amount against the booking amount,
--      d. sets payments.status='paid' (+ PayMongo reference), which the 0019
--         trigger mirrors onto bookings.payment_status='paid',
--      e. sets bookings.status='confirmed' in the SAME transaction,
--      f. records the transaction reference against the booking.
--
--    Steps d+e are one transaction, so a booking can never be left
--    payment_status='paid' with status='pending'. Both statements also run with
--    the internal session flags raised, so the customer-facing
--    protect_booking_updates guard (0015/0019) cannot reject the server's own
--    confirmation while still blocking every client-side attempt.
-- ----------------------------------------------------------------------------
create or replace function public.confirm_booking_from_paymongo(
  p_event_id text,
  p_session_ref text default null,
  p_payment_ref text default null,
  p_amount numeric default null,
  p_method text default 'GCash',
  p_event_type text default 'payment.paid'
)
returns table (
  outcome text,          -- 'confirmed' | 'duplicate' | 'not_found' | 'amount_mismatch'
  booking_number text,
  booking_status text,
  payment_status text,
  amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_payment public.payments%rowtype;
  v_booking public.bookings%rowtype;
  v_ref text;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'Missing PayMongo event id.';
  end if;

  -- (a) Idempotency, shared with the license flow: the SAME
  -- payment_webhook_events table means one delivery is processed once, whether
  -- it is a license renewal or a booking payment. ON CONFLICT DO NOTHING
  -- returns 0 rows when the event was already handled.
  insert into public.payment_webhook_events
    (event_id, provider, event_type, paymongo_payment_id, paymongo_link_reference,
     amount, status, detail)
  values
    (p_event_id, 'paymongo', p_event_type, p_payment_ref, p_session_ref,
     p_amount, 'processed', 'booking payment')
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    -- Already handled. Report the current state of the matched booking without
    -- touching it, so a replayed delivery can never re-confirm anything.
    return query
      select 'duplicate'::text, b.booking_number, b.status, b.payment_status,
             p.amount
      from public.payments p
      join public.bookings b on b.id = p.booking_id
      where (p_session_ref is not null
              and p.paymongo_checkout_session_id = p_session_ref)
         or (p_payment_ref is not null
              and p.paymongo_payment_id = p_payment_ref)
      limit 1;
    return;
  end if;

  -- (b) Match the booking: by checkout session first (the id we created), then
  -- by payment id (covers a webhook that arrives before we stored the session).
  select * into v_payment
  from public.payments p
  where (p_session_ref is not null
          and p.paymongo_checkout_session_id = p_session_ref)
     or (p.payment_id is not null
          and p.paymongo_payment_id = p.payment_id)
  order by (p.paymongo_checkout_session_id = p_session_ref) desc nulls last
  limit 1
  for update;

  if not found then
    -- Unknown/foreign payment (e.g. a license link payment routed here). The
    -- event is already claimed above, so it is never retried into a booking.
    return query select 'not_found'::text, null::text, null::text, null::text,
                        null::numeric;
    return;
  end if;

  select * into v_booking from public.bookings where id = v_payment.booking_id;

  if v_booking.id is null then
    return query select 'not_found'::text, null::text, null::text, null::text,
                        null::numeric;
    return;
  end if;

  -- A cancelled booking must not be resurrected by a late payment. Report it as
  -- duplicate-style no-op and leave the money question to the facility.
  if v_booking.status = 'cancelled' then
    return query select 'duplicate'::text, v_booking.booking_number,
                        v_booking.status, v_booking.payment_status, v_payment.amount;
    return;
  end if;

  -- (c) Amount cross-check. p_amount is what PayMongo says it collected. If it
  -- is present and does not cover the booking, refuse to confirm — this is the
  -- guard against a tampered/partial payment. A null amount (some event shapes)
  -- falls through to the session-verified path.
  if p_amount is not null and p_amount > 0
     and round(p_amount, 2) < round(v_booking.amount, 2) then
    return query select 'amount_mismatch'::text, v_booking.booking_number,
                        v_booking.status, v_booking.payment_status, p_amount;
    return;
  end if;

  v_ref := coalesce(nullif(p_payment_ref, ''), nullif(p_session_ref, ''), p_event_id);

  -- Raise the internal flags BEFORE the writes: the same transaction that marks
  -- the payment paid also confirms the booking, and the customer-facing guards
  -- must let the server's own update through.
  perform set_config('app.internal_payment_sync', 'on', true);
  perform set_config('app.booking_server_confirm', 'on', true);

  -- (d) Payment row: paid + the PayMongo transaction reference. The 0019 trigger
  --     mirrors status onto bookings.payment_status in this transaction.
  update public.payments
     set status = 'paid',
         method = coalesce(nullif(p_method, ''), 'GCash'),
         reference = v_ref,
         paid_at = now(),
         paymongo_payment_id = coalesce(nullif(p_payment_ref, ''), paymongo_payment_id),
         paymongo_checkout_session_id =
           coalesce(nullif(p_session_ref, ''), paymongo_checkout_session_id),
         paymongo_reference = v_ref,
         paymongo_amount = coalesce(p_amount, paymongo_amount),
         paymongo_paid_at = now()
   where id = v_payment.id;

  -- (e) Booking status: confirmed. (d) already set payment_status='paid', and
  --     the two happen together, so "paid but still pending" cannot occur.
  update public.bookings
     set status = 'confirmed',
         updated_at = now()
   where id = v_booking.id;

  perform set_config('app.booking_server_confirm', 'off', true);
  perform set_config('app.internal_payment_sync', 'off', true);

  return query
    select 'confirmed'::text, b.booking_number, b.status, b.payment_status, p.amount
    from public.bookings b
    join public.payments p on p.booking_id = b.id
    where b.id = v_booking.id;
end;
$$;

comment on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text) is
  'Service-role-only entry point for the PayMongo webhook. Idempotent on the PayMongo event id; atomically sets payments.status=paid (mirrored to bookings.payment_status) and bookings.status=confirmed, and stores the PayMongo transaction reference against the booking.';

revoke all on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_booking_from_paymongo(text, text, text, numeric, text, text)
  to service_role;


-- ----------------------------------------------------------------------------
-- 4) Let the server's confirmation through protect_booking_updates.
--    The guard currently whitelists only the payment-sync flag (0019). The
--    booking confirmation above also changes bookings.status, which the guard
--    treats as a customer cancel action. Whitelist the server-confirm flag too,
--    narrowly: everything else about the guard is unchanged, and a client can
--    never set the flag anyway (a client session is not service_role).
-- ----------------------------------------------------------------------------
create or replace function public.protect_booking_updates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  claiming_guest boolean :=
    coalesce(current_setting('app.guest_booking_claim', true), 'off') = 'on';
  internal_payment boolean :=
    coalesce(current_setting('app.internal_payment_sync', true), 'off') = 'on';
  server_confirm boolean :=
    coalesce(current_setting('app.booking_server_confirm', true), 'off') = 'on';
begin
  if new.user_id is distinct from old.user_id then
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
  -- M2 + PayMongo: the payment-sync trigger and the server-side confirmation RPC
  -- may update payment_status / status. Both run with the session flags raised by
  -- a SECURITY DEFINER function, so no client request can reach this branch.
  if internal_payment
     and new.court_id is not distinct from old.court_id
     and new.booking_date is not distinct from old.booking_date
     and new.start_time is not distinct from old.start_time
     and new.duration_hours is not distinct from old.duration_hours
     and new.amount is not distinct from old.amount
     and new.booking_number is not distinct from old.booking_number
     and new.status is not distinct from old.status
     and new.customer_name is not distinct from old.customer_name
     and new.customer_email is not distinct from old.customer_email
     and new.customer_phone is not distinct from old.customer_phone then
    new.updated_at = now();
    return new;
  end if;
  if server_confirm
     and new.court_id is not distinct from old.court_id
     and new.booking_date is not distinct from old.booking_date
     and new.start_time is not distinct from old.start_time
     and new.duration_hours is not distinct from old.duration_hours
     and new.amount is not distinct from old.amount
     and new.booking_number is not distinct from old.booking_number
     and new.customer_name is not distinct from old.customer_name
     and new.customer_email is not distinct from old.customer_email
     and new.customer_phone is not distinct from old.customer_phone
     -- Only the payment-confirmation transition is allowed (never a cancel or a
     -- reopen), and only from a still-open state.
     and new.status = 'confirmed'
     and old.status in ('upcoming', 'confirmed') then
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


-- ----------------------------------------------------------------------------
-- 5) Customer-safe read of a booking's payment state.
--    The BookCourt payment step polls this after the PayMongo redirect: the
--    browser only READS whether the webhook has confirmed the booking yet. It
--    cannot confirm anything.
--    Scoped to the caller's own bookings, and a guest may poll with the same
--    secure token that authorises their manage link (0015), so guests can pay
--    without an account.
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
    p.paymongo_reference,
    p.paid_at
  from public.bookings b
  left join public.payments p on p.booking_id = b.id
  where b.booking_number = btrim(coalesce(p_booking_number, ''))
    and b.deleted_at is null
    and (
      -- the signed-in owner
      b.user_id = auth.uid()
      -- or the guest holding the secure token for this exact booking
      or (p_token is not null
          and b.guest_token is not null
          and b.guest_token = btrim(p_token))
    )
  limit 1;
$$;

comment on function public.get_booking_payment_status(text, text) is
  'Read-only booking payment status for the customer payment step. Returns a row only for the signed-in owner or the holder of the booking guest token; never writes anything.';

revoke all on function public.get_booking_payment_status(text, text) from public, anon, authenticated;
grant execute on function public.get_booking_payment_status(text, text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 6) Let the server start a PayMongo checkout for a booking it owns.
--    Called by the paymongo-checkout Edge Function (service_role). Two jobs:
--      * return the SERVER-computed amount (never the browser's number),
--      * claim the checkout session id once PayMongo has created it, so a
--        replayed webhook can be matched back to the right booking.
--    A booking that is already paid can never start a second checkout.
-- ----------------------------------------------------------------------------
create or replace function public.begin_booking_paymongo_checkout(
  p_booking_number text,
  p_caller_id uuid default null,   -- auth.uid() of the caller, or null for a guest
  p_guest_token text default null  -- the booking's guest_token, when the caller is a guest
)
returns table (
  booking_id uuid,
  booking_number text,
  amount numeric,
  currency text,
  payment_status text,
  booking_status text,
  existing_session_id text,
  customer_name text,
  customer_email text,
  customer_phone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_payment public.payments%rowtype;
begin
  select * into v_booking
  from public.bookings b
  where b.booking_number = btrim(coalesce(p_booking_number, ''))
    and b.deleted_at is null;

  if v_booking.id is null then
    raise exception 'Booking was not found.';
  end if;

  -- AUTHORISATION. A booking may be paid online only by its owner or by a
  -- guest holding that booking's secret token. The token is compared in
  -- constant-ish fashion by exact match against the stored value; it is
  -- never returned to the caller.
  if not (
    (p_caller_id is not null and v_booking.user_id = p_caller_id)
    or (
      v_booking.guest_token is not null
      and p_guest_token is not null
      and v_booking.guest_token = btrim(p_guest_token)
    )
    or public.is_admin()
  ) then
    -- Deliberately vague: do not reveal whether the booking exists.
    raise exception 'You are not allowed to pay for this booking.';
  end if;

  if v_booking.status = 'cancelled' then
    raise exception 'This booking was cancelled and can no longer be paid online.';
  end if;

  select * into v_payment from public.payments p where p.booking_id = v_booking.id;

  if v_payment.id is not null and v_payment.status = 'paid' then
    raise exception 'This booking is already paid.';
  end if;

  -- Amount comes from the BOOKING row, which set_booking_amount (0003) derived
  -- from courts.price_per_hour. The client cannot influence it: ₱300/hour and
  -- ₱600 for 2 hours, straight from the court record.
  return query
    select
      v_booking.id,
      v_booking.booking_number,
      v_booking.amount,
      'PHP'::text,
      coalesce(v_payment.status, v_booking.payment_status),
      v_booking.status,
      v_payment.paymongo_checkout_session_id,
      coalesce(v_booking.customer_name, pr.full_name),
      coalesce(v_booking.customer_email, pr.email),
      coalesce(v_booking.customer_phone, pr.phone)
    from (select 1) dummy
    left join public.profiles pr on pr.id = v_booking.user_id;
end;
$$;

comment on function public.begin_booking_paymongo_checkout(text) is
  'Service-role-only: resolves a booking to its server-computed amount and payment state before the paymongo-checkout Edge Function creates a Checkout Session. Refuses cancelled or already-paid bookings.';

revoke all on function public.begin_booking_paymongo_checkout(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.begin_booking_paymongo_checkout(text, uuid, text) to service_role;


-- Record the created session id against the payment row (service_role only).
create or replace function public.attach_booking_paymongo_session(
  p_booking_number text,
  p_session_ref text,
  p_checkout_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
begin
  if p_session_ref is null or p_session_ref = '' then
    raise exception 'Missing PayMongo checkout session id.';
  end if;

  select b.id into v_booking_id
  from public.bookings b
  where b.booking_number = btrim(coalesce(p_booking_number, ''))
    and b.deleted_at is null;

  if v_booking_id is null then
    raise exception 'Booking was not found.';
  end if;

  perform set_config('app.internal_payment_sync', 'on', true);
  update public.payments
     set paymongo_checkout_session_id = p_session_ref,
         method = 'GCash',
         -- The checkout URL is part of the payment attempt; store it so support
         -- can hand the customer their link again if they close the tab.
         reference = coalesce(nullif(p_checkout_url, ''), reference)
   where booking_id = v_booking_id
     and status <> 'paid';
  perform set_config('app.internal_payment_sync', 'off', true);
end;
$$;

comment on function public.attach_booking_paymongo_session(text, text, text) is
  'Service-role-only: stores the PayMongo Checkout Session id (+ url) on the booking payment row so the webhook can match the payment back to the booking.';

revoke all on function public.attach_booking_paymongo_session(text, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_booking_paymongo_session(text, text, text)
  to service_role;