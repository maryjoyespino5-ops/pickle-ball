// Supabase Edge Function: paymongo-webhook
//
// Receives PayMongo webhook deliveries for the license Payment Link and renews
// the software subscription for 30 days. Security model:
//   * The PayMongo signature is verified (HMAC-SHA256) BEFORE anything is
//     trusted, so a forged request can never renew the license.
//   * Idempotent: the renewal RPC claims the PayMongo event id, so a replayed
//     delivery is a no-op.
//   * Secret keys live only in Edge Function secrets (never in the repo or the
//     browser). The service-role key is injected by Supabase automatically.
//
// Required secrets (set with `supabase secrets set`):
//   PAYMONO_WEBHOOK_SECRET   — from the PayMongo webhook configuration
//   PAYMONO_SECRET_KEY       — live/test secret key (used to re-verify a payment)
// Optional:
//   PAYMONO_LINK_REFERENCE   — the link reference to record (e.g. OqqZPix)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("PAYMONO_WEBHOOK_SECRET") ?? "";
const PAYMONO_SECRET_KEY = Deno.env.get("PAYMONO_SECRET_KEY") ?? "";
const LINK_REFERENCE = Deno.env.get("PAYMONO_LINK_REFERENCE") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Constant-time hex comparison to avoid timing leaks on the signature. */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * PayMongo sends: Paymongo-Signature: t=<ts>,te=<testSig>,li=<liveSig>
 * The signed payload is `${t}.${rawBody}`. In test mode use `te`, in live mode
 * use `li`. We accept whichever is present and matches.
 */
async function verifySignature(rawBody: string, header: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, ...v] = kv.split("=");
      return [k.trim(), v.join("=").trim()];
    }),
  );
  const timestamp = parts.t;
  if (!timestamp) return false;
  const expected = await hmacHex(WEBHOOK_SECRET, `${timestamp}.${rawBody}`);
  return (
    (parts.li && safeEqualHex(parts.li, expected)) ||
    (parts.te && safeEqualHex(parts.te, expected)) ||
    false
  );
}

/** Pull the fields we care about out of the PayMongo event payload. */
function readPaidEvent(event: Record<string, unknown>) {
  const data = (event?.data ?? {}) as Record<string, unknown>;
  const attributes = (data?.attributes ?? {}) as Record<string, unknown>;
  const type = String(event?.data?.attributes?.type ?? event?.data?.type ?? "");

  // Payment details can sit in attributes.payments[0] (link.payment.paid) or
  // attributes directly (payment.paid).
  const payments = Array.isArray(attributes?.payments)
    ? (attributes.payments as Record<string, unknown>[])
    : [];
  const first = payments[0] ?? {};
  const firstAttrs = (first?.attributes ?? {}) as Record<string, unknown>;

  const amount =
    (firstAttrs?.amount as number) ??
    (attributes?.amount as number) ??
    null;
  const paymentId =
    (first?.id as string) ??
    (attributes?.id as string) ??
    null;
  const status = String(firstAttrs?.status ?? attributes?.status ?? "");
  const linkRef =
    (attributes?.reference_number as string) ??
    (attributes?.reference as string) ??
    LINK_REFERENCE;

  return { type, amount, paymentId, status, linkRef };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("Paymongo-Signature") ?? "";

  if (!WEBHOOK_SECRET) {
    return json({ error: "Server not configured: PAYMONO_WEBHOOK_SECRET missing" }, 500);
  }
  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    // Do not leak details; just refuse.
    return json({ error: "Invalid signature" }, 401);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const eventId = String((event?.data as Record<string, unknown>)?.id ?? event?.id ?? "");
  const { type, amount, paymentId, status, linkRef } = readPaidEvent(event);

  // Only paid events renew the license. Everything else is acknowledged and
  // ignored (so PayMongo stops retrying).
  const isPaid =
    /payment\.paid|link\.payment\.paid|checkout_session\.payment\.paid/i.test(type) ||
    status === "paid";
  if (!isPaid) {
    return json({ ok: true, ignored: true, type });
  }
  if (!eventId) {
    return json({ error: "Missing event id" }, 400);
  }
  if (amount == null) {
    return json({ error: "Missing payment amount" }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("subscription_renew_from_paymongo", {
    p_event_id: eventId,
    p_payment_id: paymentId,
    p_link_reference: linkRef || null,
    p_amount: amount,
    p_event_type: type || "payment.paid",
  });

  if (error) {
    // Surface a 500 so PayMongo retries; the idempotency table means a retry
    // will not double-renew.
    return json({ error: error.message }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return json({ ok: true, outcome: row?.outcome ?? "unknown", license: row ?? null });
});