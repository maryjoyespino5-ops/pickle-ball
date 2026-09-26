export const BOOKING_STATUSES = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

/**
 * The simplified lifecycle, in order. A booking starts PENDING, becomes
 * CONFIRMED automatically when a GCash payment is verified, and becomes
 * COMPLETED automatically once its scheduled end time passes (migration 0024,
 * complete_past_bookings on a 5-minute schedule). CANCELLED is terminal and
 * reachable from PENDING or CONFIRMED.
 */
export const BOOKING_LIFECYCLE = [
  BOOKING_STATUSES.PENDING,
  BOOKING_STATUSES.CONFIRMED,
  BOOKING_STATUSES.COMPLETED,
];

/**
 * Payment lifecycle: PENDING -> PAID. A GCash payment sets PAID automatically;
 * a Pay at Court booking stays PENDING until an admin marks it paid. REFUNDED is
 * an admin-only terminal state kept for the Refund action.
 */
export const PAYMENT_STATUSES = {
  PENDING: "pending",
  PAID: "paid",
  REFUNDED: "refunded",
};

/** Statuses a customer may still cancel from. */
export const CANCELLABLE_STATUSES = [
  BOOKING_STATUSES.PENDING,
  BOOKING_STATUSES.CONFIRMED,
];
export const HOURLY_RATE = 300;

/**
 * L2: The facility operates in a single timezone. Booking wall-clock times are
 * stored WITHOUT an offset (a date + HH:00), and the past-slot rule
 * (0013_reject_past_bookings.sql) compares against Asia/Manila on the server.
 * The client mirrors that rule using the viewer's browser clock for instant
 * feedback — correct for a Manila-based facility. If this facility is ever used
 * across timezones, switch every comparison to this IANA zone on both sides.
 */
export const FACILITY_TIMEZONE = "Asia/Manila";
export const COURT_HOURS = [
  "07:00",
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
  "21:00",
];

