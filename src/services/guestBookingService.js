import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { isPastSlot } from "../utils/dateUtils";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

function formatTime(value) {
  return String(value || "").slice(0, 5);
}

/**
 * Translate low-level database errors into friendly guest copy — the same
 * convention bookingService uses for the signed-in flow.
 */
function friendlyGuestError(error) {
  const message = String(error?.message || "");
  if (
    error?.code === "23P01" ||
    error?.code === "23505" ||
    message.includes("bookings_no_overlap") ||
    message.includes("duplicate key")
  ) {
    return new Error("That court is already booked for this time.");
  }
  return error;
}

/**
 * Mirror of the database rule (0013_reject_past_bookings.sql) so a stale tab
 * gets the friendly message instantly instead of a round trip.
 */
function assertFutureSlot({ date, time }) {
  if (!date || !time) return;
  if (isPastSlot(date, time)) {
    throw new Error(
      "That date and time has already passed. Please choose an upcoming slot.",
    );
  }
}

/** Map a guest RPC row into the shape the public pages use. */
function toGuestBooking(row) {
  if (!row) return null;
  return {
    reference: row.booking_number,
    // Only create_guest_booking returns the secret; reads never do.
    token: row.guest_token || "",
    courtName: row.court_name || "Court",
    date: row.booking_date,
    time: formatTime(row.start_time),
    duration: Number(row.duration_hours) || 1,
    amount: Number(row.amount) || 0,
    status: row.status,
    paymentStatus: row.payment_status,
    // Settled payment details (0023): a GCash-paid booking reports
    // method=GCash plus the PayMongo reference and the time it was paid, so the
    // guest page can show PAID + CONFIRMED rather than a generic label.
    paymentMethod: row.payment_method || "Pay at Court",
    paymentReference: row.payment_reference || "",
    paidAt: row.paid_at || null,
    isPaid: row.payment_status === "paid",
    isConfirmed: ["confirmed", "completed"].includes(row.status),
    customerName: row.customer_name || "",
    customerPhone: row.customer_phone || "",
    isClaimed: Boolean(row.is_claimed),
    createdAt: row.created_at,
  };
}

async function callGuestRpc(name, args) {
  assertSupabase();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw friendlyGuestError(error);
  return data;
}

/**
 * Public URL a booking QR code / confirmation link encodes. Prefers
 * VITE_SITE_URL (same convention as the paddle QR codes) so a link printed or
 * shared from a localhost test run still points at the deployed site.
 */
export function bookingManageUrl(reference, token) {
  const configured = String(import.meta.env.VITE_SITE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const base = configured || window.location.origin;
  const path = `/booking/${encodeURIComponent(reference)}`;
  return token ? `${base}${path}?t=${encodeURIComponent(token)}` : `${base}${path}`;
}

/** Create a booking for a guest (no account, no login). */
export async function createGuestBooking({
  courtId,
  date,
  time,
  duration = 1,
  name,
  phone,
}) {
  assertFutureSlot({ date, time });
  const data = await callGuestRpc("create_guest_booking", {
    p_court_id: courtId,
    p_date: date,
    p_start_time: time,
    p_duration: Number(duration) || 1,
    p_name: name,
    p_phone: phone,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The booking could not be created. Please try again.");
  return toGuestBooking(row);
}

/** Open a booking with its secure link (the QR code from the confirmation). */
export async function getGuestBooking(reference, token) {
  const data = await callGuestRpc("get_guest_booking", {
    p_reference: reference,
    p_token: token,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return toGuestBooking(row);
}

/** Recover a booking with its reference + the mobile number used to book. */
export async function lookupGuestBooking(reference, phone) {
  const data = await callGuestRpc("lookup_guest_booking", {
    p_reference: reference,
    p_phone: phone,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return toGuestBooking(row);
}

/** Cancel through the secure link. */
export async function cancelGuestBooking(reference, token) {
  const data = await callGuestRpc("cancel_guest_booking", {
    p_reference: reference,
    p_token: token,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return toGuestBooking(row);
}

/** Cancel after recovering the booking with reference + mobile number. */
export async function cancelGuestBookingByPhone(reference, phone) {
  const data = await callGuestRpc("cancel_guest_booking_by_phone", {
    p_reference: reference,
    p_phone: phone,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return toGuestBooking(row);
}

/**
 * Optional "create an account after booking" step: attach the guest booking
 * (and its payment record) to the signed-in account so it appears in
 * My Bookings and the customer's booking history.
 */
export async function claimGuestBooking(reference, token) {
  const data = await callGuestRpc("claim_guest_booking", {
    p_reference: reference,
    p_token: token,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return toGuestBooking(row);
}

export const guestBookingService = {
  createGuestBooking,
  getGuestBooking,
  lookupGuestBooking,
  cancelGuestBooking,
  cancelGuestBookingByPhone,
  claimGuestBooking,
  bookingManageUrl,
};
