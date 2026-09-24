import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { BOOKING_STATUSES } from "../lib/constants";
import { isPastSlot } from "../utils/dateUtils";

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

/**
 * Mirror of the database rule (0013_reject_past_bookings.sql): a booking can
 * never be created or moved into a date/time that has already passed. The
 * browser clock is used so the friendly message appears instantly and matches
 * the timezone the booking wall-clock was made in.
 */
function assertFutureSlot({ date, time }) {
  if (!date || !time) return;
  if (isPastSlot(date, time)) {
    throw new Error(
      "That date and time has already passed. Please choose an upcoming slot.",
    );
  }
}

/** Map a bookings row (with joined court name) into the shape the UI uses. */
function toAppBooking(row) {
  return {
    id: row.booking_number,
    courtId: row.court_id,
    courtName: row.courts?.name || "Court",
    paddleId: row.paddle_id,
    paddleNumber: row.paddles?.paddle_number || "",
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
  "id, booking_number, user_id, court_id, paddle_id, booking_date, start_time, duration_hours, amount, status, payment_status, created_at, courts(name), paddles(paddle_number, name)";

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

export async function createBooking({ courtId, date, time, duration = 1 }) {
  assertSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to book a court.");
  assertFutureSlot({ date, time });

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      user_id: user.id,
      court_id: courtId,
      booking_date: date,
      start_time: time,
      duration_hours: Number(duration) || 1,
    })
    .select(bookingSelect)
    .single();

  if (error) throw friendlyBookingError(error);
  return toAppBooking(data);
}

export async function cancelBooking(id) {
  assertSupabase();
  // Belt-and-braces ownership filter: RLS already scopes updates to the caller,
  // but scoping the query too keeps the intent explicit and avoids a confusing
  // "no rows" error if the id belongs to someone else.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to cancel a booking.");
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: BOOKING_STATUSES.CANCELLED })
    .eq("booking_number", id)
    .eq("user_id", user.id)
    .select(bookingSelect)
    .single();
  if (error) throw friendlyBookingError(error);
  return toAppBooking(data);
}

/* ADMIN_SECTION */

/* -------------------------------------------------------------------------
 * Admin-side (Supabase-backed, RLS grants admins full visibility)
 * ---------------------------------------------------------------------- */

/** id -> profile lookup so admin tables can show customer names.
 * Cached for 60 seconds — every admin screen (bookings, payments, QR codes,
 * reports) needs the same map, so refetching all profiles per screen is
 * wasted work. The short TTL keeps freshly-registered customers visible.
 */
let profilesCache = null;
let profilesCacheAt = 0;
const PROFILES_CACHE_MS = 60000;

export async function fetchProfilesMap() {
  const now = Date.now();
  if (profilesCache && now - profilesCacheAt < PROFILES_CACHE_MS) {
    return profilesCache;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone");
  if (error) throw error;
  profilesCache = Object.fromEntries(
    (data || []).map((profile) => [profile.id, profile]),
  );
  profilesCacheAt = now;
  return profilesCache;
}

/**
 * The admin UI refers to courts as "court-1" / "court-2" in filters and
 * reschedule forms; resolve those keys to real court UUIDs from the database.
 */
/* P4: cache the court name->id map for the app session. */
let courtMapCache = null;

export async function resolveCourtId(value) {
  if (!value || value === "all") return null;
  if (!courtMapCache) {
    const { data, error } = await supabase.from("courts").select("id, name");
    if (error) throw error;
    courtMapCache = data || [];
  }
  const courts = courtMapCache;
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
    // Guest bookings come from the public booking flow and have no account:
    // user_id is null and the guest's own details live on the row.
    isGuest: !row.user_id,
    source: row.user_id ? "account" : "guest",
    customer:
      row.customer_name ||
      profile?.full_name ||
      profile?.email ||
      "Walk-in guest",
    email: row.customer_email || profile?.email || "",
    phone: row.customer_phone || profile?.phone || "",
    courtId: row.court_id,
    courtName: row.courts?.name || "Court",
    paddleId: row.paddle_id,
    paddleNumber: row.paddles?.paddle_number || "",
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
  // M5: search pushed to the database over the booking columns (customer_name,
  // customer_email, customer_phone, booking_number). Wrapped in %...% so a
  // partial match works. Kept case-insensitive with ilike.
  if (filters.search) {
    const term = String(filters.search).replace(/[%,()]/g, "").trim();
    if (term) {
      const like = `%${term}%`;
      query = query.or(
        [
          `booking_number.ilike.${like}`,
          `customer_name.ilike.${like}`,
          `customer_email.ilike.${like}`,
          `customer_phone.ilike.${like}`,
        ].join(","),
      );
    }
  }
  // M4: optional server-side pagination. When limit is given the caller gets
  // just that page (plus the total count) instead of every row.
  if (filters.limit) {
    const from = filters.offset || 0;
    query = query.range(from, from + filters.limit - 1);
  }
  const { data, error, count } = await query;
  if (error) throw error;
  const profiles = await fetchProfilesMap();
  let result = (data || []).map((row) =>
    toAdminBooking(row, profiles[row.user_id]),
  );
  // Guest vs registered-account bookings. `source` is derived from user_id, so
  // it is filtered here.
  if (filters.source && filters.source !== "all") {
    result = result.filter((booking) =>
      filters.source === "guest" ? booking.isGuest : !booking.isGuest,
    );
  }
  // Search already filtered server-side for the booking columns; this keeps
  // matching the joined court name too (a Supabase .or() cannot span a join).
  if (filters.search) {
    const term = String(filters.search).toLowerCase();
    const hasServerMatch = (data || []).length > 0;
    if (!hasServerMatch) {
      result = result.filter((booking) =>
        `${booking.id} ${booking.customer} ${booking.email} ${booking.phone} ${booking.courtName}`
          .toLowerCase()
          .includes(term),
      );
    }
  }
  if (filters.limit) {
    return { rows: result, count: count ?? result.length };
  }
  return result;
}

export async function updateBooking(id, changes) {
  assertSupabase();
  const payload = {};
  if (changes.status) payload.status = changes.status;
  if (changes.paymentStatus) payload.payment_status = changes.paymentStatus;
  if (changes.paddleId !== undefined) payload.paddle_id = changes.paddleId || null;
  if (changes.courtId) payload.court_id = await resolveCourtId(changes.courtId);
  if (changes.date || changes.time) {
    assertFutureSlot({ date: changes.date, time: changes.time });
    if (changes.date) payload.booking_date = changes.date;
    if (changes.time) payload.start_time = changes.time;
  }

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
  paymentMethod = "Pay at Court",
}) {
  assertSupabase();
  const resolvedCourtId = await resolveCourtId(courtId);
  assertFutureSlot({ date, time });
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

  // B3: persist the payment method the admin chose. The DB default is
  // "Pay at Court" (set by the payments trigger), so only update on a custom
  // choice. An admin can always flip it later on the Payments page.
  if (data?.id && paymentMethod && paymentMethod !== "Pay at Court") {
    const { error: payError } = await supabase
      .from("payments")
      .update({ method: paymentMethod })
      .eq("booking_id", data.id);
    if (payError) throw payError;
  }

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

/** Link an existing booking to a physical paddle (QR Code management). */
export async function assignPaddleToBooking(paddleId, bookingNumber) {
  assertSupabase();
  return updateBooking(bookingNumber, { paddleId });
}

/** Release a paddle from its booking (the booking itself is untouched). */
export async function unassignPaddleFromBooking(bookingNumber) {
  assertSupabase();
  return updateBooking(bookingNumber, { paddleId: null });
}

/**
 * Soft-delete a booking (M8): marks deleted_at instead of destroying the row,
 * so the record stays recoverable and reports/audit history stay consistent.
 * The row is hidden from every client SELECT afterwards (RLS).
 */
export async function softDeleteBooking(bookingNumber) {
  assertSupabase();
  const { error } = await supabase
    .from("bookings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("booking_number", bookingNumber);
  if (error) throw error;
}

/** Restore a soft-deleted booking. */
export async function restoreBooking(bookingNumber) {
  assertSupabase();
  const { error } = await supabase
    .from("bookings")
    .update({ deleted_at: null })
    .eq("booking_number", bookingNumber);
  if (error) throw error;
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
  assignPaddleToBooking,
  unassignPaddleFromBooking,
  softDeleteBooking,
  restoreBooking,
};

