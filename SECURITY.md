# Security Operations Checklist

This app keeps its security guarantees in the **database** (RLS, triggers,
`SECURITY DEFINER` RPCs) and in Supabase project settings. A few controls live
in the Supabase **dashboard**, not in code — verify them there.

## Required dashboard settings (verify once, re-check on changes)

### 1. Realtime + RLS  (audit item H5)
Customer screens subscribe to `public.bookings` through one shared channel
(`src/lib/realtimeBus.js`), filtered by `user_id=eq.<id>`. That filter is a
**convenience**, not the security boundary — the boundary is RLS.

- [ ] Supabase Dashboard → Database → Replication → confirm `bookings` is in the
      Realtime publication.
- [ ] Confirm **Realtime authorization / RLS** is enabled for `bookings`, so a
      customer's socket only ever receives rows their RLS policy allows.
- [ ] If Realtime RLS cannot be enabled, do **not** rely on the client filter —
      broadcast a "something changed" signal on a dedicated table the customer
      is allowed to see, instead of the raw `bookings` rows.

### 2. Auth rate limits  (audit item C3 / S3)
- [ ] Authentication → Rate Limits: keep the defaults (or lower them) on sign-in,
      sign-up and password-recovery.
- [ ] No CAPTCHA is required today because guest lookups now need an unguessable
      reference AND the phone number (references carry a random suffix — see
      `0017_critical_hardening.sql`). Add Turnstile/hCaptcha if abuse appears.

### 3. Admin account  (audit item C1)
- [ ] The previously committed admin password is considered compromised — if
      `0008_seed_admin.sql` ever ran against this database, **rotate it now**
      (Authentication → Users → reset password).
- [ ] No migration sets a default admin password. Create/reset admins only via
      the dashboard or an `encrypted_password` UPDATE with your own strong value.

## Client-secret rule  (audit item H2)
Every `VITE_*` value is inlined into the shipped JavaScript. Only the Supabase
**URL** and **anon key** may be `VITE_`-prefixed — both are public by design and
protected by RLS. A service-role key, JWT secret or DB password must never be
`VITE_`-prefixed; the build **fails on purpose** if it detects one
(`vite.config.js` → `assertNoClientSecrets`).

## What protects what (so nobody "fixes" the wrong layer)

| Concern | Enforced by | Where |
|---|---|---|
| Double-booking / races | `bookings_no_overlap` EXCLUDE constraint | `0006`, `0007` |
| Price integrity | `set_booking_amount()` trigger | `0003`, `0006` |
| Duration limit | `assert_booking_duration()` trigger | `0017` |
| Past-slot rejection | `reject_past_booking_slot()` trigger | `0013` |
| Role escalation | `prevent_role_change()` trigger + `is_admin()` | `0001`, `0006` |
| Guest booking access | 122-bit `guest_token` + RPCs | `0015` |
| Non-enumerable references | random suffix in `assign_booking_number()` | `0017` |
| Payment ↔ booking sync | `sync_booking_payment_status()` trigger | `0019` |
| License enforcement | `assert_subscription_active()` + anti-tamper | `0014` |
| Row visibility | RLS policies on every table | `0001`–`0019` |