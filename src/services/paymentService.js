import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { fetchProfilesMap } from "./bookingService";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

/** Customer-side: view only. RLS guarantees the rows belong to the current user. */
export async function getMyPayments() {
  assertSupabase();
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, booking_id, amount, method, status, reference, paid_at, created_at, bookings(booking_number, booking_date, start_time, courts(name))",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    bookingNumber: row.bookings?.booking_number || row.booking_id,
    bookingDate: row.bookings?.booking_date,
    startTime: row.bookings?.start_time,
    courtName: row.bookings?.courts?.name,
    amount: Number(row.amount),
    method: row.method,
    status: row.status,
    reference: row.reference,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }));
}

/* ---------------------------------------------------------------------------
 * Admin-side (Supabase-backed, RLS grants admins payment management)
 * ------------------------------------------------------------------------ */

const paymentSelect =
  "id, booking_id, amount, method, status, reference, paid_at, created_at, bookings(booking_number, booking_date, start_time, status, payment_status, user_id, customer_name, courts(name))";

function toAppPayment(row, profiles) {
  const booking = row.bookings || {};
  const profile = profiles ? profiles[booking.user_id] : null;
  return {
    id: row.id,
    bookingId: row.booking_id,
    bookingNumber: booking.booking_number || row.booking_id,
    customer:
      booking.customer_name ||
      profile?.full_name ||
      profile?.email ||
      "Walk-in guest",
    courtName: booking.courts?.name || "Court",
    date: booking.booking_date,
    time: String(booking.start_time || "").slice(0, 5),
    amount: Number(row.amount),
    paymentMethod: row.method || "Pay at Court",
    paymentStatus: row.status,
    status: booking.status,
    reference: row.reference,
    paidAt: row.paid_at,
  };
}

export async function getPayments() {
  assertSupabase();
  const [{ data, error }, profiles] = await Promise.all([
    supabase
      .from("payments")
      .select(paymentSelect)
      .order("created_at", { ascending: false }),
    fetchProfilesMap(),
  ]);
  if (error) throw error;
  return (data || []).map((row) => toAppPayment(row, profiles));
}

export async function updatePayment(id, paymentStatus) {
  assertSupabase();
  const patch = { status: paymentStatus };
  if (paymentStatus === "paid") patch.paid_at = new Date().toISOString();
  // The payments_sync_booking_status trigger mirrors this onto
  // bookings.payment_status in the same transaction (M2), so we no longer do a
  // separate, race-prone booking update here.
  const { data, error } = await supabase
    .from("payments")
    .update(patch)
    .eq("id", id)
    .select(paymentSelect)
    .single();
  if (error) throw error;
  const profiles = await fetchProfilesMap();
  return toAppPayment(data, profiles);
}

/**
 * Recover a booking whose PayMongo payment was collected but never confirmed
 * (the webhook-routing bug). Unlike updatePayment this goes through the SAME
 * database RPC the live webhook uses: confirm_booking_from_paymongo, via
 * reconcile_booking_payment (0022). That means the amount is still cross-checked
 * against the booking and payments.status/bookings.status commit atomically —
 * the browser cannot force a booking to be paid.
 *
 * @param {string} bookingNumber the booking reference (RB-...)
 * @param {object} [args]
 * @param {string} [args.sessionRef] PayMongo cs_... session id
 * @param {string} [args.paymentRef] PayMongo pay_... payment id
 * @param {number} [args.amount]     amount PayMongo collected (pesos)
 */
export async function reconcilePayment(
  bookingNumber,
  { sessionRef = "", paymentRef = "", amount = null, method = "GCash" } = {},
) {
  assertSupabase();
  if (!bookingNumber) throw new Error("A booking reference is required.");

  const { data, error } = await supabase.rpc("reconcile_booking_payment", {
    p_booking_number: bookingNumber,
    p_event_id: null,
    p_session_ref: sessionRef || null,
    p_payment_ref: paymentRef || null,
    p_amount: amount == null ? null : Number(amount),
    p_method: method || "GCash",
  });
  if (error) throw error;

  return Array.isArray(data) ? data[0] : data;
}

/** Admin audit list: bookings that reached PayMongo but still look unpaid. */
export async function getStuckPayments() {
  assertSupabase();
  const { data, error } = await supabase.rpc("find_stuck_booking_payments", {
    p_since: null,
  });
  if (error) throw error;
  return data || [];
}

export const paymentService = {
  getMyPayments,
  getPayments,
  updatePayment,
  reconcilePayment,
  getStuckPayments,
};
