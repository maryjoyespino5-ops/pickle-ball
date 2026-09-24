export const BOOKING_STATUSES = {
  UPCOMING: "upcoming",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};
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

