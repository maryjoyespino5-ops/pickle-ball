import { supabase, isSupabaseConfigured } from "../lib/supabase";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

async function fetchCustomerStats() {
  // M3: server-side aggregation — one row per customer, not every booking.
  const { data, error } = await supabase.rpc("customer_stats");
  if (error) throw error;
  const stats = {};
  (data || []).forEach((row) => {
    stats[row.user_id] = {
      totalBookings: Number(row.total_bookings) || 0,
      totalSpent: Number(row.total_spent) || 0,
      lastBooking: row.last_booking || null,
    };
  });
  return stats;
}

/* ---------------------------------------------------------------------------
 * Admin-side: the customers directory. RLS lets admins read every profile;
 * customers can only ever read their own.
 * ------------------------------------------------------------------------ */

export async function getCustomers(search = "") {
  assertSupabase();
  const term = String(search || "").replace(/[%,()]/g, "").trim();
  // M5: push the search onto the profiles query instead of filtering in JS.
  let profilesQuery = supabase
    .from("profiles")
    .select("id, full_name, email, phone, role")
    .eq("role", "customer")
    .order("created_at", { ascending: false });
  if (term) {
    const like = `%${term}%`;
    profilesQuery = profilesQuery.or(
      `full_name.ilike.${like},email.ilike.${like},phone.ilike.${like}`,
    );
  }
  const [{ data: profiles, error: profilesError }, stats] = await Promise.all([
    profilesQuery,
    fetchCustomerStats(),
  ]);
  if (profilesError) throw profilesError;

  return (profiles || []).map((profile) => ({
    id: profile.id,
    name: profile.full_name || profile.email,
    email: profile.email,
    phone: profile.phone || "",
    totalBookings: stats[profile.id]?.totalBookings || 0,
    totalSpent: stats[profile.id]?.totalSpent || 0,
    lastBooking: stats[profile.id]?.lastBooking || "—",
    status: (stats[profile.id]?.totalBookings || 0) > 0 ? "active" : "inactive",
  }));
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
