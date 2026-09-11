import { supabase, isSupabaseConfigured } from "../lib/supabase";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

async function fetchCustomerStats() {
  const { data, error } = await supabase
    .from("bookings")
    .select("user_id, booking_date, amount, status, payment_status");
  if (error) throw error;
  const stats = {};
  (data || []).forEach((booking) => {
    const entry = stats[booking.user_id] || {
      totalBookings: 0,
      totalSpent: 0,
      lastBooking: null,
    };
    if (booking.status !== "cancelled") entry.totalBookings += 1;
    if (booking.payment_status === "paid")
      entry.totalSpent += Number(booking.amount);
    if (
      booking.booking_date &&
      (!entry.lastBooking || booking.booking_date > entry.lastBooking)
    )
      entry.lastBooking = booking.booking_date;
    stats[booking.user_id] = entry;
  });
  return stats;
}

/* ---------------------------------------------------------------------------
 * Admin-side: the customers directory. RLS lets admins read every profile;
 * customers can only ever read their own.
 * ------------------------------------------------------------------------ */

export async function getCustomers(search = "") {
  assertSupabase();
  const [{ data: profiles, error: profilesError }, stats] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, phone, role")
      .eq("role", "customer")
      .order("created_at", { ascending: false }),
    fetchCustomerStats(),
  ]);
  if (profilesError) throw profilesError;

  const customers = (profiles || []).map((profile) => ({
    id: profile.id,
    name: profile.full_name || profile.email,
    email: profile.email,
    phone: profile.phone || "",
    totalBookings: stats[profile.id]?.totalBookings || 0,
    totalSpent: stats[profile.id]?.totalSpent || 0,
    lastBooking: stats[profile.id]?.lastBooking || "—",
    status: (stats[profile.id]?.totalBookings || 0) > 0 ? "active" : "inactive",
  }));

  const term = search.toLowerCase();
  if (!term) return customers;
  return customers.filter((customer) =>
    `${customer.name} ${customer.email} ${customer.phone}`
      .toLowerCase()
      .includes(term),
  );
}

export async function getCustomer(id) {
  assertSupabase();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .eq("id", id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return null;

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select(
      "booking_number, booking_date, start_time, amount, status, payment_status, courts(name)",
    )
    .eq("user_id", id)
    .order("booking_date", { ascending: false })
    .limit(5);
  if (bookingsError) throw bookingsError;

  const active = (bookings || []).filter(
    (booking) => booking.status !== "cancelled",
  );
  return {
    id: profile.id,
    name: profile.full_name || profile.email,
    email: profile.email,
    phone: profile.phone || "",
    totalBookings: active.length,
    totalSpent: (bookings || [])
      .filter((booking) => booking.payment_status === "paid")
      .reduce((sum, booking) => sum + Number(booking.amount), 0),
    lastBooking: (bookings || [])[0]?.booking_date || "—",
    status: active.length > 0 ? "active" : "inactive",
    bookings: (bookings || []).map((booking) => ({
      id: booking.booking_number,
      courtName: booking.courts?.name || "Court",
      date: booking.booking_date,
      time: String(booking.start_time || "").slice(0, 5),
      amount: Number(booking.amount),
      status: booking.status,
      paymentStatus: booking.payment_status,
    })),
  };
}

export const customerService = { getCustomers, getCustomer };
