import { supabase, isSupabaseConfigured } from "../lib/supabase";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

/** The facility operates in Manila time — the public RPC uses it too. */
const FACILITY_TZ = "Asia/Manila";

/** Today's date (YYYY-MM-DD) in facility time, independent of the browser tz. */
export function facilityTodayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: FACILITY_TZ });
}


/** Paddle QR tokens follow the /paddle/:token route, e.g. paddle-001. */
export function qrTokenFor(paddleNumber) {
  return `paddle-${String(paddleNumber || "").trim().padStart(3, "0")}`;
}

/**
 * Build the public scan URL a QR sticker encodes. Prefers VITE_SITE_URL when
 * set, so printed QRs always point at the deployed site even if they are
 * generated while testing on localhost. Falls back to the current origin.
 */
export function paddleUrl(qrToken) {
  const configured = String(import.meta.env.VITE_SITE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const base = configured || window.location.origin;
  return `${base}/paddle/${qrToken}`;
}

/**
 * Derive the current paddle state from its linked booking (if any), using the
 * EXISTING booking fields (booking_date + start_time + duration_hours) exactly
 * like the public get_paddle_status RPC does, but on the client for the admin
 * table so the remaining time stays live.
 */
function deriveStatus(isActive, booking, nowMs) {
  if (!isActive) return "disabled";
  if (!booking) return "available";
  if (nowMs < booking.startMs) return "reserved";
  if (nowMs < booking.endMs) return "in_use";
  return "available";
}

/**
 * Parse a booking's rental window in the BROWSER's timezone — the same way
 * createBooking writes it and every other screen displays it. (The RPC
 * mirrors this on the server via the p_offset_minutes argument.)
 */
function windowFor(bookingRow) {
  if (!bookingRow) return null;
  const startMs = new Date(
    `${bookingRow.booking_date}T${String(bookingRow.start_time).slice(0, 5)}:00`,
  ).getTime();
  const endMs = startMs + Number(bookingRow.duration_hours) * 60 * 60 * 1000;
  return { startMs, endMs };
}

/**
 * Pick the booking that drives a paddle's status — the same rule the public
 * RPC applies: the currently active rental first, otherwise the soonest
 * upcoming one. Finished rentals are ignored so an earlier slot can never
 * mask a later one that is in use right now.
 */
function pickBooking(bookingRows, nowMs) {
  let active = null;
  let upcoming = null;
  for (const row of bookingRows) {
    const window = windowFor(row);
    if (!window) continue;
    if (nowMs >= window.endMs) continue; // finished — irrelevant
    if (nowMs >= window.startMs) {
      if (!active || window.endMs < windowFor(active).endMs) active = row;
    } else if (!upcoming || window.startMs < windowFor(upcoming).startMs) {
      upcoming = row;
    }
  }
  return active || upcoming || null;
}

function toPaddle(row, bookingMap = {}, profileMap = {}) {
  const bookingRow = bookingMap[row.id] || null;
  const window = windowFor(bookingRow);
  const booking = bookingRow
    ? {
        id: bookingRow.booking_number,
        customer:
          bookingRow.customer_name ||
          profileMap[bookingRow.user_id]?.full_name ||
          profileMap[bookingRow.user_id]?.email ||
          "Walk-in guest",
        courtName: bookingRow.courts?.name || "Court",
        date: bookingRow.booking_date,
        time: String(bookingRow.start_time).slice(0, 5),
        duration: Number(bookingRow.duration_hours),
        startMs: window.startMs,
        endMs: window.endMs,
      }
    : null;
  return {
    id: row.id,
    paddleNumber: row.paddle_number,
    name: row.name || "",
    qrToken: row.qr_token,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    booking,
    status: deriveStatus(row.is_active, booking, Date.now()),
  };
}

/* ---------------------------------------------------------------------------
 * Admin-side paddle management (RLS restricts `paddles` to admins).
 * ------------------------------------------------------------------------ */

export async function getPaddles() {
  assertSupabase();
  const [paddleResult, bookingResult, profileResult] = await Promise.all([
    supabase.from("paddles").select("*").order("paddle_number"),
    supabase
      .from("bookings")
      .select(
        "booking_number, user_id, paddle_id, court_id, booking_date, start_time, duration_hours, status, customer_name, courts(name)",
      )
      // From facility-today onward (not strictly today): a paddle linked to a
      // future booking must show Reserved, and a booking from any date that is
      // currently inside its rental window must show In Use.
      .gte("booking_date", facilityTodayISO())
      .in("status", ["upcoming", "confirmed"])
      .order("booking_date")
      .order("start_time"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  if (paddleResult.error) throw paddleResult.error;
  if (bookingResult.error) throw bookingResult.error;
  if (profileResult.error) throw profileResult.error;

  // Group linked bookings per paddle, then apply the same pick rule as the
  // public RPC (active rental first, else the soonest upcoming one).
  const byPaddle = {};
  (bookingResult.data || []).forEach((b) => {
    if (!b.paddle_id) return;
    if (!byPaddle[b.paddle_id]) byPaddle[b.paddle_id] = [];
    byPaddle[b.paddle_id].push(b);
  });
  const bookingMap = {};
  Object.entries(byPaddle).forEach(([paddleId, rows]) => {
    const picked = pickBooking(rows, Date.now());
    if (picked) bookingMap[paddleId] = picked;
  });
  const profileMap = Object.fromEntries(
    (profileResult.data || []).map((p) => [p.id, p]),
  );
  return (paddleResult.data || []).map((row) =>
    toPaddle(row, bookingMap, profileMap),
  );
}

export async function createPaddle({ paddleNumber, name = "" }) {
  assertSupabase();
  const number = String(paddleNumber || "").trim();
  if (!number) throw new Error("Paddle number is required.");
  const { data, error } = await supabase
    .from("paddles")
    .insert({
      paddle_number: number,
      name: String(name || "").trim(),
      qr_token: qrTokenFor(number),
      status: "available",
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")
      throw new Error(
        `A paddle with number "${number}" already exists. Use a different number.`,
      );
    throw error;
  }
  return toPaddle(data);
}

export async function updatePaddle(id, changes) {
  assertSupabase();
  const payload = {};
  if (changes.name !== undefined)
    payload.name = String(changes.name || "").trim();
  if (changes.paddleNumber !== undefined)
    payload.paddle_number = String(changes.paddleNumber).trim();
  if (changes.isActive !== undefined) payload.is_active = Boolean(changes.isActive);
  if (changes.status !== undefined) payload.status = changes.status;
  if (changes.qrToken !== undefined) payload.qr_token = changes.qrToken;
  if (Object.keys(payload).length === 0) return getPaddles();
  const { data, error } = await supabase
    .from("paddles")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505")
      throw new Error("Another paddle already uses that number.");
    throw error;
  }
  return toPaddle(data);
}
/** Issue a fresh, unique QR token for an existing paddle. */
export async function regenerateQrToken(id) {
  assertSupabase();
  const { data: current, error: readError } = await supabase
    .from("paddles")
    .select("paddle_number")
    .eq("id", id)
    .single();
  if (readError) throw readError;
  const base = qrTokenFor(current?.paddle_number);
  const { data: clash } = await supabase
    .from("paddles")
    .select("id")
    .eq("qr_token", base)
    .neq("id", id)
    .maybeSingle();
  const qrToken = clash ? `${base}-${Math.random().toString(36).slice(2, 7)}` : base;
  const { data, error } = await supabase
    .from("paddles")
    .update({ qr_token: qrToken })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toPaddle(data);
}

export async function deletePaddle(id) {
  assertSupabase();
  const { error } = await supabase.from("paddles").delete().eq("id", id);
  if (error) throw error;
}

export async function setPaddleActive(id, isActive) {
  return updatePaddle(id, { isActive });
}

/* ---------------------------------------------------------------------------
 * Public scan page: /paddle/:token  ->  security-definer RPC (no customer data).
 * ------------------------------------------------------------------------ */

export async function getPublicPaddleStatus(token) {
  assertSupabase();
  const { data, error } = await supabase.rpc("get_paddle_status", {
    p_token: String(token || ""),
    // Interpret the booking's wall-clock in the SAME timezone as the rest of
    // the app (the viewer's browser). JS: UTC-8 => +480.
    p_offset_minutes: -new Date().getTimezoneOffset(),
  });
  if (error) throw error;
  return data && data.length ? data[0] : null;
}

export const paddleService = {
  getPaddles,
  createPaddle,
  updatePaddle,
  regenerateQrToken,
  deletePaddle,
  setPaddleActive,
  getPublicPaddleStatus,
  qrTokenFor,
  paddleUrl,
};