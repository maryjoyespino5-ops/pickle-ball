import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { BOOKING_STATUSES } from "../lib/constants";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

function formatTime(value) {
  return String(value).slice(0, 5);
}

function toMinutes(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

/** Translate low-level constraint violations into friendly errors. */
function friendlyBookingError(error) {
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

/** Map a bookings row (with joined court name) into the shape the UI uses. */
function toAppBooking(row) {
  return {
    id: row.booking_number,
    courtId: row.court_id,
    courtName: row.courts?.name || "Court",
    date: row.booking_date,
    time: formatTime(row.start_time),
    duration: Number(row.duration_hours),
    amount: Number(row.amount),
    status: row.status,
    paymentStatus: row.payment_status,
    createdAt: row.created_at,
  };
}

const bookingSelect =
  "id, booking_number, user_id, court_id, booking_date, start_time, duration_hours, amount, status, payment_status, created_at, courts(name)";

const adminSelect = `${bookingSelect}, customer_name, customer_email, customer_phone, payments(method)`;

/* -------------------------------------------------------------------------
 * Customer-side (Supabase-backed, RLS limits rows to the signed-in customer)
 * ---------------------------------------------------------------------- */

export async function getMyBookings() {
  assertSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select(bookingSelect)
    .order("booking_date", { ascending: false })
    .order("start_time", { ascending: false });
  if (error) throw error;
  return (data || []).map(toAppBooking);
}

export async function getBooking(id) {
  assertSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select(bookingSelect)
    .eq("booking_number", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toAppBooking(data) : null;
}

export async function createBooking({ courtId, date, time }) {
  assertSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to book a court.");

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      user_id: user.id,
      court_id: courtId,
      booking_date: date,
      start_time: time,
      duration_hours: 1,
    })
    .select(bookingSelect)
    .single();

  if (error) throw friendlyBookingError(error);
  return toAppBooking(data);
}

export async function cancelBooking(id) {
  assertSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: BOOKING_STATUSES.CANCELLED })
    .eq("booking_number", id)
    .select(bookingSelect)
    .single();
  if (error) throw friendlyBookingError(error);
  return toAppBooking(data);
}

/* ADMIN_SECTION */

/* -------------------------------------------------------------------------
 * Admin-side (Supabase-backed, RLS grants admins full visibility)
 * ---------------------------------------------------------------------- */

/** id -> profile lookup so admin tables can show customer names. */
export async function fetchProfilesMap() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone");
  if (error) throw error;
  return Object.fromEntries(
    (data || []).map((profile) => [profile.id, profile]),
  );
}

/**
 * The admin UI refers to courts as "court-1" / "court-2" in filters and
 * reschedule forms; resolve those keys to real court UUIDs from the database.
 */
export async function resolveCourtId(value) {
  if (!value || value === "all") return null;
  const { data, error } = await supabase.from("courts").select("id, name");
  if (error) throw error;
  const courts = data || [];
  if (courts.some((court) => court.id === value)) return value;
  const slot = String(value).replace("court-", "");
  const byName = courts.find(
    (court) => court.name.toLowerCase() === `court ${slot}`,
  );
  return byName ? byName.id : value;
}

function toAdminBooking(row, profile) {
  return {
    id: row.booking_number,
    userId: row.user_id,
    customer:
      row.customer_name ||
      profile?.full_name ||
      profile?.email ||
      "Walk-in guest",
    email: row.customer_email || profile?.email || "",
    phone: row.customer_phone || profile?.phone || "",
    courtId: row.court_id,
    courtName: row.courts?.name || "Court",
    date: row.booking_date,
    time: formatTime(row.start_time),
    duration: Number(row.duration_hours),
    amount: Number(row.amount),
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payments?.[0]?.method || "Pay at Court",
    createdAt: row.created_at,
  };
}

/** Client-side pre-check so admins get a friendly message before the
 * bookings_no_overlap exclusion constraint rejects the write. */
async function assertNoOverlap({ courtId, date, time, duration, ignoreId }) {
  const { data, error } = await supabase
    .from("bookings")
    .select("booking_number, start_time, duration_hours")
    .eq("court_id", courtId)
    .eq("booking_date", date)
    .neq("status", "cancelled");
  if (error) throw error;
  const start = toMinutes(time);
  const end = start + Number(duration) * 60;
  const clash = (data || []).some((booking) => {
    if (ignoreId && booking.booking_number === ignoreId) return false;
    const from = toMinutes(formatTime(booking.start_time));
    const to = from + Number(booking.duration_hours) * 60;
    return from < end && start < to;
  });
  if (clash) throw new Error("That court is already booked for this time.");
}

async function getAdminBookingRow(id) {
  const { data, error } = await supabase
    .from("bookings")
    .select(adminSelect)
    .eq("booking_number", id)
    .maybeSingle();
  if (error) throw friendlyBookingError(error);
  return data;
}

export async function getAllBookings(filters = {}) {
  assertSupabase();
  let query = supabase
    .from("bookings")
    .select(adminSelect)
    .order("created_at", { ascending: false });
  if (filters.date) query = query.eq("booking_date", filters.date);
  if (filters.status && filters.status !== "all")
    query = query.eq("status", filters.status);
  if (filters.paymentStatus && filters.paymentStatus !== "all")
    query = query.eq("payment_status", filters.paymentStatus);
  if (filters.court && filters.court !== "all") {
    const courtId = await resolveCourtId(filters.court);
    if (courtId) query = query.eq("court_id", courtId);
  }
  const { data, error } = await query;
  if (error) throw error;
  const profiles = await fetchProfilesMap();
  let result = (data || []).map((row) =>
    toAdminBooking(row, profiles[row.user_id]),
  );
  if (filters.search) {
    const term = filters.search.toLowerCase();
    result = result.filter((booking) =>
      `${booking.id} ${booking.customer} ${booking.courtName}`
        .toLowerCase()
        .includes(term),
    );
  }
  return result;
}

export async function updateBooking(id, changes) {
  assertSupabase();
  const payload = {};
  if (changes.status) payload.status = changes.status;
  if (changes.paymentStatus) payload.payment_status = changes.paymentStatus;
  if (changes.courtId) payload.court_id = await resolveCourtId(changes.courtId);
  if (changes.date) payload.booking_date = changes.date;
  if (changes.time) payload.start_time = changes.time;

  if (Object.keys(payload).length === 0) {
    const existing = await getAdminBookingRow(id);
    if (!existing) throw new Error("Booking was not found.");
    const profiles = await fetchProfilesMap();
    return toAdminBooking(existing, profiles[existing.user_id]);
  }

  const { data, error } = await supabase
    .from("bookings")
    .update(payload)
    .eq("booking_number", id)
    .select(adminSelect)
    .single();
  if (error) throw friendlyBookingError(error);
  const profiles = await fetchProfilesMap();
  return toAdminBooking(data, profiles[data.user_id]);
}

export async function createAdminBooking({
  courtId,
  date,
  time,
  customer,
  email,
  phone,
  duration = 1,
}) {
  assertSupabase();
  const resolvedCourtId = await resolveCourtId(courtId);
  await assertNoOverlap({ courtId: resolvedCourtId, date, time, duration });
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      user_id: null,
      court_id: resolvedCourtId,
      booking_date: date,
      start_time: time,
      duration_hours: Number(duration),
      status: "confirmed",
      customer_name: customer || "Walk-in guest",
      customer_email: email || null,
      customer_phone: phone || null,
    })
    .select(adminSelect)
    .single();
  if (error) throw friendlyBookingError(error);
  const profiles = await fetchProfilesMap();
  return toAdminBooking(data, profiles[data.user_id]);
}

export async function rescheduleBooking(id, { courtId, date, time }) {
  assertSupabase();
  const existing = await getAdminBookingRow(id);
  if (!existing) throw new Error("Booking was not found.");
  const resolvedCourtId = await resolveCourtId(courtId);
  await assertNoOverlap({
    courtId: resolvedCourtId,
    date,
    time,
    duration: existing.duration_hours,
    ignoreId: id,
  });
  return updateBooking(id, { courtId: resolvedCourtId, date, time });
}

export const bookingService = {
  getMyBookings,
  getBooking,
  createBooking,
  cancelBooking,
  getAllBookings,
  updateBooking,
  createAdminBooking,
  rescheduleBooking,
};

