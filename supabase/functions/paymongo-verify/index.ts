// Supabase Edge Function: paymongo-verify
//
// Server-side verification of a GCash booking payment — the self-healing
// fallback for the webhook.
//
// Why it exists: a booking is confirmed by the signed webhook
// (paymongo-webhook -> confirm_booking_from_paymongo). If that delivery never
// arrives — the PayMongo webhook is not subscribed to
// checkout_session.payment.paid, a delivery was lost, a retry failed, a cold
// start timed out — the player's money sits at PayMongo while the booking still
// reads pending, and somebody has to repair it by hand.
//
// This function closes that gap without weakening anything:
//   * it authorises the caller exactly like checkout does: the signed-in owner
//     (JWT) or the holder of the booking's secret guest token (probe RPC);
//   * it asks PAYMONGO ITSELF, server-side with the secret key, whether the
//     Checkout Session we created was paid;
//   * if it was, it calls the SAME database confirmation the webhook uses
//     (confirm_booking_from_paymongo), so the amount is still cross-checked
//     against the booking and the write is still atomic and idempotent;
//   * if it was not, it reports "still waiting" and writes nothing.
//
// The browser can therefore never mark itself paid: it may only ASK, and the
// answer comes from PayMongo.
//
// Required secrets (already set for the other functions):
//   PAYMONO_SECRET_KEY — sk_test_... while testing, sk_live_... in production

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYMONO_SECRET_KEY = Deno.env.get("PAYMONO_SECRET_KEY") ?? "";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

type PaymongoAttrs = Record<string, unknown>;

/** PayMongo reports amounts in CENTAVOS: ₱300.00 === 30000. */
const toPesos = (centavos: unknown): number | null =>
  typeof centavos === "number" ? Math.round(centavos) / 100 : null;

/**
 * Read the settled payment (if any) out of a Checkout Session resource.
 *
 * PayMongo exposes the outcome two ways for a paid session:
 *   * attributes.payments[]          — the payments made against it (status 'paid')
 *   * attributes.payment_intent.attributes.status — 'succeeded'
 * Both are checked, and the amount is read from whichever is present.
 */
function readSessionPayment(session: PaymongoAttrs) {
  const payments = Array.isArray(session?.payments)
    ? (session.payments as PaymongoAttrs[])
    : [];
  const paid = payments.find(
    (payment) =>
      String((payment?.attributes as PaymongoAttrs)?.status ?? "") === "paid",
  );
  const paidAttrs = (paid?.attributes ?? {}) as PaymongoAttrs;

  const intentAttrs = ((session?.payment_intent as PaymongoAttrs)?.attributes ??
    {}) as PaymongoAttrs;
  const intentStatus = String(intentAttrs?.status ?? "");
  const intentPayments = Array.isArray(intentAttrs?.payments)
    ? (intentAttrs.payments as PaymongoAttrs[])
    : [];

  return {
    paid: Boolean(paid) || intentStatus === "succeeded",
    paymentId:
      String(paid?.id ?? "") || String(intentPayments[0]?.id ?? "") || null,
    amount: toPesos(paidAttrs?.amount) ?? toPesos(intentAttrs?.amount),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!PAYMONO_SECRET_KEY) {
    return json({ error: "Server not configured: PAYMONO_SECRET_KEY missing" }, 500);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const bookingNumber = String(
    (payload?.bookingNumber ?? payload?.booking_number ?? "") as string,
  ).trim();
  if (!bookingNumber) {
    return json({ error: "bookingNumber is required" }, 400);
  }
  const guestToken =
    String(payload?.guestToken ?? payload?.token ?? "").trim() || null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Resolve the signed-in caller (if any) from the JWT, exactly like checkout.
  let callerId: string | null = null;
  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (jwt) {
    const { data } = await supabase.auth.getUser(jwt);
    callerId = data?.user?.id ?? null;
  }

  // --- 1) Authorised read: whose booking is this, and is it already paid? ---
  const { data: probeRows, error: probeError } = await supabase.rpc(
    "booking_payment_probe",
    {
      p_booking_number: bookingNumber,
      p_caller_id: callerId,
      p_guest_token: guestToken,
    },
  );
  if (probeError) {
    const msg = String(probeError.message ?? "");
    const status = /not allowed|not found/i.test(msg) ? 404 : 400;
    return json({ error: msg || "Booking was not found." }, status);
  }
  const probe = (Array.isArray(probeRows) ? probeRows[0] : probeRows) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!probe) {
    return json({ error: "Booking was not found." }, 404);
  }

  const dbPaymentStatus = String(probe.payment_status ?? "");
  const dbBookingStatus = String(probe.booking_status ?? "");
  if (dbPaymentStatus === "paid") {
    return json({
      ok: true,
      paid: true,
      source: "database",
      already: true,
      bookingNumber,
      bookingStatus: dbBookingStatus,
      paymentStatus: dbPaymentStatus,
    });
  }
  if (dbBookingStatus === "cancelled") {
    return json({
      ok: true,
      paid: false,
      source: "database",
      bookingNumber,
      bookingStatus: dbBookingStatus,
      paymentStatus: dbPaymentStatus,
    });
  }

  const sessionId = String(probe.paymongo_checkout_session_id ?? "");
  if (!sessionId) {
    return json({
      ok: true,
      paid: false,
      source: "database",
      reason: "no_session",
      bookingNumber,
      bookingStatus: dbBookingStatus,
      paymentStatus: dbPaymentStatus,
    });
  }

  // --- 2) Ask PayMongo itself what happened to the session we created. ---
  const auth = btoa(`${PAYMONO_SECRET_KEY}:`);
  let sessionRes: Response;
  try {
    sessionRes = await fetch(
      `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(sessionId)}`,
      { headers: { authorization: `Basic ${auth}` } },
    );
  } catch (err) {
    return json({
      ok: true,
      paid: false,
      source: "paymongo_unreachable",
      reason: err instanceof Error ? err.message : "PayMongo request failed.",
      bookingNumber,
      bookingStatus: dbBookingStatus,
      paymentStatus: dbPaymentStatus,
    });
  }
  const sessionBody = (await sessionRes.json().catch(() => null)) as {
    data?: { attributes?: PaymongoAttrs };
  } | null;
  if (!sessionRes.ok || !sessionBody?.data) {
    return json({
      ok: true,
      paid: false,
      source: "paymongo_error",
      reason: `PayMongo returned HTTP ${sessionRes.status}.`,
      bookingNumber,
      bookingStatus: dbBookingStatus,
      paymentStatus: dbPaymentStatus,
    });
  }

  const settled = readSessionPayment(
    (sessionBody.data.attributes ?? {}) as PaymongoAttrs,
  );
  if (!settled.paid) {
    return json({
      ok: true,
      paid: false,
      source: "paymongo",
      bookingNumber,
      bookingStatus: dbBookingStatus,
      paymentStatus: dbPaymentStatus,
    });
  }

  // --- 3) Paid at PayMongo: commit through the SAME path the webhook uses. ---
  const { data, error } = await supabase.rpc("confirm_booking_from_paymongo", {
    p_event_id: `verify-${sessionId}`,
    p_session_ref: sessionId,
    p_payment_ref: settled.paymentId,
    p_amount: settled.amount,
    p_method: "GCash",
    p_event_type: "verify.checkout_session.paid",
  });
  if (error) {
    return json({ error: error.message }, 502);
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<
    string,
    unknown
  > | null;
  const outcome = String(row?.outcome ?? "unknown");
  // confirm_booking_from_paymongo returns 'paid' for a fresh success (0029 made
  // a payment settle MONEY only, leaving bookings.status alone) and 'duplicate'
  // when this event id was already applied. Both mean the player has paid.
  // 'confirmed' is the pre-0029 literal and is still accepted so a function
  // deployed ahead of its migration still reports the truth.
  const paid =
    outcome === "paid" || outcome === "confirmed" || outcome === "duplicate";

  return json({
    ok: true,
    paid,
    source: "paymongo",
    outcome,
    bookingNumber: String(row?.booking_number ?? bookingNumber),
    bookingStatus: String(row?.booking_status ?? dbBookingStatus),
    paymentStatus: String(row?.payment_status ?? dbPaymentStatus),
  });
});
