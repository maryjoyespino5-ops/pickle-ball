// Supabase Edge Function: paymongo-webhook
//
// Receives PayMongo webhook deliveries and acts on them server-side. It handles
// TWO independent flows, routed by which booking the payment belongs to:
//
//   1. PLAYER COURT BOOKING â€” when the paid checkout session/payment matches a
//      booking, the booking is confirmed (payment_status='paid',
//      booking_status='confirmed') via confirm_booking_from_paymongo(). This is
//      the ONLY thing that confirms a booking: the frontend redirect is never
//      trusted.
//   2. SOFTWARE LICENSE â€” otherwise, the â‚±999/month subscription is renewed
//      (existing 0020 behaviour, unchanged).
//
// Security model:
//   * The PayMongo signature is verified (HMAC-SHA256) BEFORE anything is
//     trusted, so a forged request can confirm nothing.
//   * Idempotent: both RPCs claim the PayMongo event id in the shared
//     payment_webhook_events ledger, so a replayed delivery is a no-op.
//   * Secret keys live only in Edge Function secrets (never in the repo or the
//     browser). The service-role key is injected by Supabase automatically.
//
// Required secrets (set with `supabase secrets set`):
//   PAYMONO_WEBHOOK_SECRET   â€” from the PayMongo webhook configuration
//   PAYMONO_SECRET_KEY       â€” sk_test_... while testing, sk_live_... in prod
// Optional:
//   PAYMONO_LINK_REFERENCE   â€” the license link reference (e.g. OqqZPix)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WEBHOOK_SECRET = Deno.env.get("PAYMONO_WEBHOOK_SECRET") ?? "";
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
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * PayMongo sends: Paymongo-Signature: t=<ts>,te=<testSig>,li=<liveSig>
 * The signed payload is `${t}.${rawBody}`. In test mode use `te`, in live mode
 * use `li`. We accept whichever is present and matches.
 */
async function verifySignature(
  rawBody: string,
  header: string,
): Promise<boolean> {
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
  // PayMongo event envelope:
  //   { data: { id, type: "event", attributes: {
  //       type: "link.payment.paid", livemode,
  //       data: { id, type: "link"|"payment", attributes: { amount, status,
  //               reference_number, payments: [{ id, attributes: {...} }] } }
  //   } } }
  // Some event types put the resource fields directly under data.attributes
  // (no extra `data` level). We accept both shapes.
  const eventAttrs = ((event?.data as Record<string, unknown>)?.attributes ??
    {}) as Record<string, unknown>;
  const resource = (eventAttrs?.data ?? eventAttrs) as Record<string, unknown>;
  const attributes = (resource?.attributes ?? resource ?? {}) as Record<
    string,
    unknown
  >;
  const type = String(
    eventAttrs?.type ?? (event?.data as Record<string, unknown>)?.type ?? "",
  );

  // Payment details can sit in attributes.payments[0] (link.payment.paid) or in
  // the resource itself (payment.paid).
  const payments = Array.isArray(attributes?.payments)
    ? (attributes.payments as Record<string, unknown>[])
    : [];
  const first = payments[0] ?? {};
  const firstAttrs = (first?.attributes ?? {}) as Record<string, unknown>;

  // PayMongo reports amounts in CENTAVOS (99900 = â‚±999.00). Convert to pesos
  // the database understands, matching how the license fee is stored.
  const rawAmount =
    (firstAttrs?.amount as number) ?? (attributes?.amount as number) ?? null;
  const amount =
    typeof rawAmount === "number" ? Math.round(rawAmount) / 100 : null;

  // For checkout_sessions the resource id is the cs_... session id; the actual
  // payment id arrives under payments[0] or attributes.payment_id.
  const resourceType = String(resource?.type ?? "");
  const paymentId =
    (first?.id as string) ??
    (resourceType === "payment" ? (resource?.id as string) : null) ??
    (attributes?.id as string) ??
    null;

  const sessionId =
    resourceType === "checkout_session"
      ? ((resource?.id as string) ?? null)
      : null;

  const status = String(firstAttrs?.status ?? attributes?.status ?? "");

  // reference_number is set by US when creating the checkout session: the
  // booking number for a player booking, or the license link reference.
  // It can appear on the resource itself OR on the nested payment, so check
  // both — relying on one nesting level is what made booking payments look
  // like license renewals.
  const reference = String(
    (attributes?.reference_number as string) ??
      (firstAttrs?.reference_number as string) ??
      (attributes?.reference as string) ??
      (firstAttrs?.reference as string) ??
      "",
  ).trim();

  // metadata is attached to the CHECKOUT SESSION we created. Different event
  // shapes expose it at different depths (and some omit it entirely), so read
  // every plausible location instead of a single path.
  const metadataSources = [
    attributes?.metadata,
    firstAttrs?.metadata,
    resource?.metadata,
    eventAttrs?.metadata,
  ];
  let metaBookingNumber = "";
  for (const source of metadataSources) {
    const candidate = String(
      ((source as Record<string, unknown>)?.booking_number as string) ?? "",
    ).trim();
    if (candidate) {
      metaBookingNumber = candidate;
      break;
    }
  }

  return {
    type,
    amount,
    paymentId,
    sessionId,
    status,
    reference,
    metaBookingNumber,
    linkRef: reference || LINK_REFERENCE,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: { "access-control-allow-origin": "*" },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("Paymongo-Signature") ?? "";

  if (!WEBHOOK_SECRET) {
    return json(
      { error: "Server not configured: PAYMONO_WEBHOOK_SECRET missing" },
      500,
    );
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

  const eventId = String(
    (event?.data as Record<string, unknown>)?.id ?? event?.id ?? "",
  );
  // `reference` and `linkRef` MUST be destructured: the routing decision below
  // (does this paid event belong to a player booking?) and the license fallback
  // both read them. Leaving them out raised a ReferenceError — which escaped as
  // a 500 BEFORE confirm_booking_from_paymongo() was ever called, so a
  // successful GCash payment never flipped the booking to PAID and PayMongo saw
  // a failure and retried forever.
  const {
    type,
    amount,
    paymentId,
    sessionId,
    status,
    metaBookingNumber,
    reference,
    linkRef,
  } = readPaidEvent(event);

  // PayMongo reports the instrument used (e.g. "gcash") on the payment
  // resource. Fall back to the label the booking flow expects.
  const method = String(event?.method ?? "GCash").trim() || "GCash";

  // Only paid events renew the license. Everything else is acknowledged and
  // ignored (so PayMongo stops retrying).
  const isPaid =
    /payment\.paid|link\.payment\.paid|checkout_session\.payment\.paid/i.test(
      type,
    ) || status === "paid";
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

  // -------------------------------------------------------------------------
  // Route the paid event to the RIGHT flow.
  //
  // Two independent products share this webhook:
  //   1. PLAYER COURT BOOKINGS  -> confirm_booking_from_paymongo()
  //        (payment_status='paid' + status='confirmed' for that booking)
  //   2. SOFTWARE LICENSE       -> subscription_renew_from_paymongo()
  //
  // We tell them apart by the reference/metadata WE set when creating the
  // checkout session: a player booking carries its booking number. Treating a
  // court payment as a license renewal (the previous behaviour) would both
  // fail to confirm the booking and wrongly extend the license.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Which product is this? A player booking carries its booking number in
  // metadata.booking_number AND/OR reference_number (the paymongo-checkout
  // function sets both). Metadata is dropped by some PayMongo event shapes, so
  // reference_number is the fallback that stops a booking payment being
  // misrouted into the ₱999 software-license renewal.
  //
  // Final safety net: if the checkout session id (or payment id) is already
  // stored on a payments row, this is unambiguously a booking payment — the
  // session id is written by attach_booking_paymongo_session() at checkout
  // time, so it survives even if every reference field goes missing.
  // -------------------------------------------------------------------------
  let bookingNumber = metaBookingNumber || "";
  if (!bookingNumber && /^RB-/i.test(reference)) {
    bookingNumber = reference;
  }

  let isBookingPayment = bookingNumber.length > 0;

  if (!isBookingPayment && (sessionId || paymentId)) {
    const orFilter = [
      sessionId ? `paymongo_checkout_session_id.eq.${sessionId}` : null,
      paymentId ? `paymongo_payment_id.eq.${paymentId}` : null,
    ]
      .filter(Boolean)
      .join(",");

    if (orFilter) {
      const { data: known } = await supabase
        .from("payments")
        .select("booking_id, bookings(booking_number)")
        .or(orFilter)
        .limit(1)
        .maybeSingle();

      if (known?.booking_id) {
        isBookingPayment = true;
        // Recover the booking number so the confirmation RPC can still match
        // the row by reference if the session lookup inside it misses.
        // The joined relation may come back as an object or a 1-element array.
        const joined = (known as Record<string, unknown>).bookings as
          | { booking_number?: string }
          | { booking_number?: string }[]
          | null;
        const joinedRow = Array.isArray(joined) ? joined[0] : joined;
        bookingNumber = joinedRow?.booking_number || bookingNumber;
      }
    }
  }

  if (isBookingPayment) {
    const { data, error } = await supabase.rpc(
      "confirm_booking_from_paymongo",
      {
        p_event_id: eventId,
        p_session_ref: sessionId,
        p_payment_ref: paymentId,
        p_amount: amount,
        p_method: method,
        p_event_type: type || "checkout_session.payment.paid",
      },
    );

    if (error) {
      // 500 so PayMongo retries; the event-id ledger makes the retry safe.
      return json({ error: error.message }, 500);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return json({
      ok: true,
      target: "booking",
      outcome: row?.outcome ?? "unknown",
      booking: row ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Otherwise: software-license renewal (unchanged behaviour).
  // -------------------------------------------------------------------------
  const { data, error } = await supabase.rpc(
    "subscription_renew_from_paymongo",
    {
      p_event_id: eventId,
      p_payment_id: paymentId,
      p_link_reference: linkRef || null,
      p_amount: amount,
      p_event_type: type || "payment.paid",
    },
  );

  if (error) {
    // Surface a 500 so PayMongo retries; the idempotency table means a retry
    // will not double-renew.
    return json({ error: error.message }, 500);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return json({
    ok: true,
    target: "license",
    outcome: row?.outcome ?? "unknown",
    license: row ?? null,
  });
});
