// Supabase Edge Function: paymongo-checkout
//
// Creates a PayMongo Checkout Session so a PLAYER can pay for a court booking
// with GCash (or any other method enabled on the account). Security model:
//
//   * The AMOUNT is never taken from the browser. This function asks the
//     database (begin_booking_paymongo_checkout) for the booking's price, which
//     set_booking_amount derives from courts.price_per_hour â€” â‚±300/hour and
//     â‚±600 for 2 hours during normal operation.
//   * The PayMongo SECRET KEY lives only in Edge Function secrets. The browser
//     only ever receives the public checkout_url.
//   * The booking is NOT confirmed here and NOT confirmed by the redirect. The
//     paymongo-webhook function confirms it, after verifying PayMongo's
//     signature. This function only creates the payment attempt.
//
// Required secrets (supabase secrets set):
//   PAYMONO_SECRET_KEY   â€” sk_test_... while testing, sk_live_... in production
// Optional:
//   PAYMONO_PUBLIC_SITE_URL â€” base URL used to build the return links
//                             (defaults to the request Origin header)
//
// NOTE: while testing, use the TEST keys. PayMongo test mode moves no real
// money, so no â‚±1 price override is needed anywhere â€” the real â‚±300/â‚±600
// prices are exercised end to end.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAYMONO_SECRET_KEY = Deno.env.get("PAYMONO_SECRET_KEY") ?? "";
const PUBLIC_SITE_URL = (Deno.env.get("PAYMONO_PUBLIC_SITE_URL") ?? "")
  .trim()
  .replace(/\/+$/, "");

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

/** PayMongo takes amounts in CENTAVOS: â‚±300.00 === 30000. */
const toCentavos = (pesos: number): number => Math.round(pesos * 100);

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

  // The guest token proves ownership when nobody is signed in. It is sent in
  // the body over TLS and verified against the booking row inside
  // begin_booking_paymongo_checkout(); it is never echoed back.
  const guestToken = String(payload?.guestToken ?? payload?.token ?? "").trim() || null;
  // Resolved from the JWT below, once the client exists.
  let callerId: string | null = null;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // verify_jwt is enforced for this function, so a valid Authorization header
  // yields a real user id; an anonymous guest yields null and must instead
  // present the booking owner's guest token.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const { data: userData } = await supabase.auth.getUser(
      authHeader.slice("Bearer ".length),
    );
    callerId = userData?.user?.id ?? null;
  }

  // --- 1) The database is the source of truth for price and payment state. ---
  const { data: bookingRows, error: bookingError } = await supabase.rpc(
    "begin_booking_paymongo_checkout",
    {
      p_booking_number: bookingNumber,
      p_caller_id: callerId,
      p_guest_token: guestToken,
    },
  );

  if (bookingError) {
    // Includes: booking not found, cancelled, or already paid. The messages are
    // written to be shown to the customer as-is.
    return json({ error: bookingError.message }, 400);
  }

  const booking = Array.isArray(bookingRows) ? bookingRows[0] : bookingRows;
  if (!booking) {
    return json({ error: "Booking was not found." }, 404);
  }

  // Already paid: never create a second charge for the same booking.
  if (String(booking.payment_status) === "paid") {
    return json(
      { error: "This booking is already paid.", paymentStatus: "paid" },
      409,
    );
  }

  // Defensive: even though the price comes from the DB, make sure it is a
  // positive amount before asking PayMongo to charge it.
  const amount = Number(booking.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return json({ error: "This booking has no payable amount." }, 400);
  }

  // --- 2) Build the return links. ---
  // The Origin header makes the redirect work on localhost and on the deployed
  // site without configuration; PAYMONO_PUBLIC_SITE_URL overrides it.
  const origin = PUBLIC_SITE_URL || req.headers.get("origin") || "";
  // A signed-in player started the payment from My Bookings, so send them back
  // there — that page owns the settle-poll. A guest has no account, so they go
  // to the public manage page (which authorises with the token in ?t=).
  const returnPath = guestToken
    ? `/booking/${encodeURIComponent(bookingNumber)}`
    : "/my-bookings";
  // Reuse the token that was already parsed and verified above (guestToken).
  // This previously read `payload?.token` only, but the browser sends the
  // secret as `guestToken` (see bookingPaymentService.startBookingCheckout), so
  // the return link silently lost the `?t=` parameter for every GUEST payment.
  // The guest came back from PayMongo to a bare /booking/RB-...?paid=1 with no
  // token, so the page could neither reopen the booking nor poll the payment
  // status — the player paid and still saw "pending".
  const query = [
    guestToken ? `t=${encodeURIComponent(guestToken)}` : "",
    "paid=1",
    // Names the booking being settled so the poll targets the right row even
    // when the player has more than one unpaid booking.
    `booking=${encodeURIComponent(bookingNumber)}`,
  ]
    .filter(Boolean)
    .join("&");
  const successUrl = origin ? `${origin}${returnPath}?${query}` : undefined;
  const cancelUrl = origin
    ? `${origin}${returnPath}?${query}&cancelled=1`
    : undefined;

  const description = `${booking.booking_number} â€” ${
    booking.customer_name || "Court booking"
  }`;

  // --- 3) Create the Checkout Session at PayMongo. ---
  const body = {
    data: {
      attributes: {
        // GCash first; the account's other enabled methods stay available so
        // the player is never blocked if GCash is unavailable.
        payment_method_types: ["gcash"],
        line_items: [
          {
            currency: "PHP",
            amount: toCentavos(amount),
            name: `Court booking ${booking.booking_number}`,
            description,
            quantity: 1,
          },
        ],
        description,
        // reference_number comes back on the webhook, so it is a second way to
        // tie a payment to this booking even if the session id is not recorded.
        reference_number: bookingNumber,
        send_email_receipt: Boolean(booking.customer_email),
        show_description: true,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          booking_number: bookingNumber,
          booking_id: String(booking.booking_id ?? ""),
        },
      },
    },
  };

  const auth = btoa(`${PAYMONO_SECRET_KEY}:`);
  const res = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(body),
  });

  const result = await res.json().catch(() => null);

  if (!res.ok) {
    const detail =
      (result as { errors?: { detail?: string }[] })?.errors?.[0]?.detail ??
      `PayMongo rejected the request (HTTP ${res.status}).`;
    return json({ error: detail }, 502);
  }

  const attributes = (result as { data?: { attributes?: Record<string, unknown> } })
    ?.data?.attributes;
  const sessionId = String((result as { data?: { id?: string } })?.data?.id ?? "");
  const checkoutUrl = String(attributes?.checkout_url ?? "");

  if (!sessionId || !checkoutUrl) {
    return json({ error: "PayMongo did not return a checkout URL." }, 502);
  }

  // --- 4) Record the session id so the webhook can match the payment back. ---
  const { error: attachError } = await supabase.rpc(
    "attach_booking_paymongo_session",
    {
      p_booking_number: bookingNumber,
      p_session_ref: sessionId,
      p_checkout_url: checkoutUrl,
    },
  );

  if (attachError) {
    // The session exists at PayMongo but we could not store it. Fail loudly
    // rather than sending the player to a checkout we cannot reconcile.
    return json(
      { error: `Could not record the payment session: ${attachError.message}` },
      500,
    );
  }

  return json({
    ok: true,
    bookingNumber,
    checkoutUrl,
    checkoutSessionId: sessionId,
    amount, // pesos, for display only â€” the server already fixed the charge
    currency: "PHP",
  });
});