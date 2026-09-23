# Pickleball Booking

A React and Vite booking application for pickleball courts.

## Getting started

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and add Supabase credentials when the backend is connected.

## Deploying (important for QR code scanning)

The app uses client-side routing (`BrowserRouter`), so deep links such as the
QR scan page (`/paddle/paddle-001`) must fall back to `index.html` on the
hosting server. The repo already ships the right fallbacks:

- **Netlify** — `public/_redirects` (`/* /index.html 200`)
- **Vercel** — `vercel.json` rewrite rule
- **GitHub Pages / plain static hosts** — the build automatically copies the
  built `index.html` to `404.html` (see the `spa404Fallback` plugin in
  `vite.config.js`)

Paddle QR stickers encode the site origin + `/paddle/<qr_token>`. To make sure
QRs always point at the live site (even while generating/printing from a
localhost test run), set the canonical URL in `.env`:

```bash
VITE_SITE_URL=https://your-deployed-site.example.com
```

When no `VITE_SITE_URL` is set, the QR uses the browser's current origin — so
printing QRs from the opened **deployed** admin page always produces the
correct scan URLs.

## Software subscription (₱900 / 30 days)

The booking system is licensed to **one business**. The license is a single row
in Supabase and each successful ₱900 payment covers a 30-day period. There is
deliberately no multi-tenant SaaS layer here.

Apply `supabase/migrations/0014_subscription.sql` — it creates the license
tables, the server-side checks, the write guards, and seeds the first 30-day
period plus its initial payment row.

### Where the license lives (backend)

| Object | Purpose |
|---|---|
| `public.business_subscription` | the single license row (`id = true`): `status`, `payment_status`, `start_date`, `expires_at`, `last_payment_at`, `last_amount`, `grace_days`, `monthly_fee` |
| `public.subscription_payments` | payment / renewal history (amount, method, reference, period start + end) |
| `public.subscription_events` | license status-change log (`renewed`, `expired`, …) |
| `public.subscription_is_active()` | server verdict used by every guard: `status = 'active'` **and** `payment_status = 'paid'` **and** `expires_at + grace_days > now()` |
| `public.subscription_status()` | read-only snapshot for Admin > Subscription |
| `public.refresh_subscription_status()` | flips a lapsed `active` row to `expired` and writes the audit event (called on every admin status read — no cron job required) |
| `public.subscription_record_payment(...)` | provider-only renewal: +30 days from the later of `now()` or the current expiry |
| `public.subscription_update_settings(...)` | provider-only grace period / monthly fee |

### How enforcement works (server side — never the browser)

- The client can only **SELECT** the license tables. RLS has read policies for
  admins, and `insert` / `update` / `delete` is impossible because there is no
  write policy and the table GRANTs are revoked. Editing tokens, localStorage, or
  calling the REST API with the anon key cannot change `payment_status`,
  `expires_at`, or `status`.
- `prevent_subscription_tamper()` rejects **any** direct write to the license
  tables (`SUBSCRIPTION_READ_ONLY`); only the provider-only functions pass.
- `assert_subscription_active()` is a `BEFORE INSERT/UPDATE/DELETE` trigger on
  `bookings`, `payments`, `courts`, `paddles`, and `facility_settings`. While the
  license is expired every write fails with `SUBSCRIPTION_EXPIRED`, regardless of
  role or crafted request. Reads keep working, so the client can still view
  bookings, customers, payments, and reports.
- The frontend only *displays* the verdict (`SubscriptionContext` +
  `useSubscriptionLock`, polled every 5 minutes): admin pages render read-only
  with a renewal banner and every failed write maps to a renewal prompt. The
  customer-facing flows show a neutral "online booking is temporarily
  unavailable" message instead of license details.

### Renewing (software provider only)

Run in the Supabase SQL editor (service role — the key you never ship):

```sql
-- 1) Record the ₱900 payment. Extends 30 days from the later of now() or the
--    current expiry, so early renewals never lose days.
select * from public.subscription_record_payment(900, 'gcash', 'GCash ref 12345');

-- 2) Optional: configurable backend grace period (days) and monthly fee.
select public.subscription_update_settings(3, 900);
```

The license becomes active immediately; the client's Admin > Subscription page
picks it up automatically (or via **Re-check license**).

If the provider ever needs to hand-edit the row (for example to backdate a
period), raise the internal flag first **in the same session**:

```sql
select set_config('app.subscription_internal', 'on', true);
update public.business_subscription
   set expires_at = now() + interval '30 days'
 where id = true;
```

### Testing the lock

```sql
-- expire the license right now
select set_config('app.subscription_internal', 'on', true);
update public.business_subscription
   set expires_at = now() - interval '1 day'
 where id = true;
```

Reload the admin area: every page shows the renewal banner, write buttons are
hidden/disabled, records stay readable, and any direct API write returns
`SUBSCRIPTION_EXPIRED`. Restore with
`select public.subscription_record_payment(900, 'test', 'restore');`.
