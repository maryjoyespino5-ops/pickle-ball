# PayMongo License Renewal — Setup Guide

This connects the existing ₱999/month software-license flow to a PayMongo
Payment Link. The license renews **only** when PayMongo's verified webhook
arrives — never from a frontend success message.

## How it works

```
Admin clicks "Renew for ₱999"
        │
        ▼
Opens the PayMongo Payment Link (pm.link/.../OqqZPix) in a new tab
        │
        ▼  (customer pays ₱999)
PayMongo sends a signed webhook  ──►  Edge Function `paymongo-webhook`
                                             │  1. verifies HMAC signature
                                             │  2. claims the event id (idempotent)
                                             ▼
                             subscription_renew_from_paymongo()
                                             │
                                             ▼
                             subscription_record_payment()  ← EXISTING logic
                                   • status → active
                                   • expires_at += 30 days
                                   • payment history + audit event
        │
        ▼
Admin presses "Re-check license" → status is Active
```

## What is already done (in code)

- **UI**: the "Renew for ₱999" button opens the Payment Link; the license is
  never marked active client-side.
- **Fee aligned to ₱999** (`business_subscription.monthly_fee`), matching the
  live Payment Link.
- **Edge Function** `supabase/functions/paymongo-webhook/index.ts` — signature
  verification + idempotency.
- **Idempotency ledger** `public.payment_webhook_events` (migration `0020`).
- **Renewal RPC** `public.subscription_renew_from_paymongo()` (service-role only).

## What YOU must configure

### 1. Set Edge Function secrets
In the Supabase Dashboard → Project Settings → Edge Functions → Secrets (or via
CLI), add:

| Secret | Value | Where to get it |
|---|---|---|
| `PAYMONO_WEBHOOK_SECRET` | the webhook signing secret | PayMongo → Developers → Webhooks (created in step 3) |
| `PAYMONO_SECRET_KEY` | `sk_live_...` (**rotate the one you pasted in chat first**) | PayMongo → Developers → API Keys |
| `PAYMONO_LINK_REFERENCE` | `OqqZPix` (optional) | your Payment Link reference |

CLI form:
```bash
supabase secrets set PAYMONO_WEBHOOK_SECRET=whsk_xxx PAYMONO_SECRET_KEY=sk_live_xxx PAYMONO_LINK_REFERENCE=OqqZPix
```

> ⚠️ Never prefix these with `VITE_`. The build fails on purpose if you do
> (`vite.config.js`). Only the **public link** goes to the browser.

### 2. Deploy the function
```bash
supabase functions deploy paymongo-webhook
```
The deployed URL is:
```
https://nesqncexmypcekjapcwy.functions.supabase.co/paymongo-webhook
```

### 3. Create the webhook in PayMongo
PayMongo Dashboard → **Developers → Webhooks → Create**:
- **URL**: `https://nesqncexmypcekjapcwy.functions.supabase.co/paymongo-webhook`
- **Events**: at least `payment.paid` and `link.payment.paid`
  (add `checkout_session.payment.paid` if you later use API checkout)
- Save, then **copy the signing secret** into `PAYMONO_WEBHOOK_SECRET` (step 1).

### 4. Test in PayMongo TEST mode first
- Switch PayMongo to **Test mode**, create a **test** webhook + use `sk_test_...`.
- Pay the test link, confirm the webhook fires and the license flips to Active.
- Then repeat with live keys.

## Verifying

- Admin → **Subscription** shows the payment with method `paymongo` and the
  PayMongo payment id as reference.
- `select * from public.payment_webhook_events order by created_at desc limit 5;`
- A duplicate delivery returns `outcome: duplicate` and does **not** extend the
  license again.

## Renewal rules (unchanged)

- Each verified payment extends **30 days** from the later of now / current
  expiry (no lost days on early renewal).
- The anti-tamper trigger still blocks every direct write to the license row;
  only the provider RPCs may change it.
- While expired, the app stays **read-only** for booking/payment/court writes.
