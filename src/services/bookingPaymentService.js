import { supabase, isSupabaseConfigured } from "../lib/supabase";

/**
 * GCash / PayMongo payment for a COURT BOOKING (distinct from the â‚±999
 * software-license renewal in subscriptionService).
 *
 * Security model â€” the browser never decides anything:
 *   * The AMOUNT is computed by the database from `courts.price_per_hour`
 *     (â‚±300/hr, â‚±600/2hr). Nothing about the price is sent from here.
 *   * The Edge Function holds the PayMongo secret key; it is never shipped.
 *   * A booking becomes paid ONLY when PayMongo's signed webhook is verified
 *     server-side and confirm_booking_from_paymongo() commits.
 *   * This module therefore only ever *starts* a payment and *reads* status.
 *     The redirect back from PayMongo is never trusted as proof of payment.
 */

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

/** Label used everywhere the booking payment method is recorded. */
export const PAYMONGO_METHOD = "GCash";

/**
 * Create a PayMongo Checkout Session for a booking and return the hosted
 * checkout URL to send the player to.
 *
 * @param {object} args
 * @param {string} args.bookingNumber  the booking reference (RB-...)
 * @param {string} [args.guestToken]   the guest's secret token (unsigned users)
 * @returns {Promise<{checkoutUrl: string, sessionId: string|null, amount: number|null}>}
 */
export async function startBookingCheckout({ bookingNumber, guestToken = "" }) {
  assertSupabase();
  if (!bookingNumber) throw new Error("A booking reference is required.");

  const url = `${String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1/paymongo-checkout`;

  // Send the caller's access token when signed in, so the server can verify
  // ownership. Guests rely on guestToken instead.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = { "content-type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      bookingNumber,
      guestToken: guestToken || undefined,
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error || "Could not start the GCash payment. Please try again.",
    );
  }

  const checkoutUrl = payload?.checkoutUrl || payload?.checkout_url || "";
  if (!checkoutUrl) {
    throw new Error("PayMongo did not return a checkout link. Please try again.");
  }

  return {
    checkoutUrl,
    // The Edge Function returns checkoutSessionId; the aliases cover older
    // shapes so a mismatch can never silently drop the session reference.
    sessionId:
      payload?.checkoutSessionId ??
      payload?.checkout_session_id ??
      payload?.sessionId ??
      null,
    amount: payload?.amount == null ? null : Number(payload.amount),
  };
}

/**
 * Read the authoritative payment state of a booking.
 *
 * Works for both a signed-in owner and a guest with the secure token, because
 * get_booking_payment_status() (see migration 0021) authorises either.
 *
 * @returns {Promise<{paymentStatus: string, bookingStatus: string, reference: string|null, paidAt: string|null}>}
 */
export async function getBookingPaymentStatus({ bookingNumber, guestToken = "" }) {
  assertSupabase();
  if (!bookingNumber) throw new Error("A booking reference is required.");

  const { data, error } = await supabase.rpc("get_booking_payment_status", {
    p_booking_number: bookingNumber,
    p_token: guestToken || null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Booking was not found.");

  return {
    paymentStatus: row.payment_status,
    bookingStatus: row.booking_status,
    reference: row.paymongo_reference ?? null,
    paidAt: row.paid_at ?? null,
  };
}

/**
 * Poll until the booking stops being pending, or the deadline passes.
 *
 * Used after the player returns from the PayMongo page. The webhook is
 * usually a second or two behind the redirect, so we poll rather than assume.
 *
 * @param {object} args
 * @param {number} [args.timeoutMs]  how long to keep polling (default 90s)
 * @param {number} [args.intervalMs] delay between polls (default 3s)
 * @param {(state: object) => void} [args.onTick] called after each poll
 * @returns {Promise<{paid: boolean, state: object|null}>}
 */
export async function waitForBookingPayment({
  bookingNumber,
  guestToken = "",
  timeoutMs = 90000,
  intervalMs = 3000,
  onTick,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  // Always poll at least once, even if the clock is already past the deadline.
  do {
    try {
      last = await getBookingPaymentStatus({ bookingNumber, guestToken });
      if (onTick) onTick(last);
      if (last.paymentStatus === "paid") return { paid: true, state: last };
      if (last.bookingStatus === "cancelled") return { paid: false, state: last };
    } catch {
      // Transient failure (offline, cold start): keep trying until the deadline.
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);

  return { paid: false, state: last };
}

/** Human-readable status copy for the booking payment step. */
export function bookingPaymentMessage(state) {
  if (!state) return "";
  if (state.paymentStatus === "paid") {
    return "Payment received. Your booking is confirmed.";
  }
  if (state.bookingStatus === "cancelled") {
    return "This booking was cancelled.";
  }
  if (state.paymentStatus === "refunded") {
    return "This booking was refunded.";
  }
  return "Waiting for PayMongo to confirm your paymentâ€¦";
}

export const bookingPaymentService = {
  PAYMONGO_METHOD,
  startBookingCheckout,
  getBookingPaymentStatus,
  waitForBookingPayment,
  bookingPaymentMessage,
};
