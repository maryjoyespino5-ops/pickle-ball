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
  const { data, error } = await supabase
    .from("payments")
    .update(patch)
    .eq("id", id)
    .select(paymentSelect)
    .single();
  if (error) throw error;

  // Keep the booking's payment_status in sync so reports stay consistent.
  if (data?.booking_id) {
    const { error: bookingError } = await supabase
      .from("bookings")
      .update({ payment_status: paymentStatus })
      .eq("id", data.booking_id);
    if (bookingError) throw bookingError;
  }
  const profiles = await fetchProfilesMap();
  return toAppPayment(data, profiles);
}

export const paymentService = { getMyPayments, getPayments, updatePayment };
