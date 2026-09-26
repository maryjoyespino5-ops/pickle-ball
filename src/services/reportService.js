import { bookingService } from "./bookingService";

/** "2026-09-26" for a Date, in LOCAL time (the facility's day, not UTC). */
function isoOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Every calendar day from `fromIso` to `toIso`, inclusive. */
function eachDay(fromIso, toIso) {
  const out = [];
  const start = new Date(`${fromIso}T00:00:00`);
  const end = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  if (end < start) return out;
  // Guard against a runaway range: a line chart past ~120 points is unreadable
  // and the page would stall. The tail is the part an owner acts on.
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(isoOf(d));
  }
  return out.length > 120 ? out.slice(out.length - 120) : out;
}

/** "09:00" / "9:00 AM" -> 9. Returns null when the hour cannot be read. */
function hourOf(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const twelve = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(text);
  if (twelve) {
    let hour = Number(twelve[1]) % 12;
    if (/pm/i.test(twelve[3])) hour += 12;
    return hour;
  }
  const twentyFour = /^(\d{1,2}):/.exec(text);
  if (!twentyFour) return null;
  const hour = Number(twentyFour[1]);
  return hour >= 0 && hour <= 23 ? hour : null;
}

/** Monday-first weekday index (0 = Monday) for an ISO date. */
function mondayIndex(isoDate) {
  const day = new Date(`${isoDate}T00:00:00`).getDay(); // 0 = Sunday
  return (day + 6) % 7;
}

export async function getReport(filters = {}) {
  const bookings = await bookingService.getAllBookings({
    court: filters.court || "all",
    status: filters.status || "all",
    paymentStatus: filters.paymentStatus || "all",
  });

  // Date-range filter (booking reports / revenue reports / court performance).
  const ranged = bookings.filter(
    (booking) =>
      (!filters.from || booking.date >= filters.from) &&
      (!filters.to || booking.date <= filters.to),
  );

  const paid = ranged.filter((item) => item.paymentStatus === "paid");
  const pending = ranged.filter((item) => item.paymentStatus === "pending");

  // Court performance is aggregated from the real court IDs in the data.
  const courtMap = new Map();
  ranged.forEach((booking) => {
    const entry =
      courtMap.get(booking.courtId) ||
      { name: booking.courtName, bookings: 0, revenue: 0 };
    entry.bookings += 1;
    entry.revenue += Number(booking.amount) || 0;
    courtMap.set(booking.courtId, entry);
  });
  const courtPerformance = [...courtMap.values()];
  const maxCourtBookings = Math.max(1, ...courtPerformance.map((c) => c.bookings));
  courtPerformance.forEach((court) => {
    court.share = Math.round((court.bookings / maxCourtBookings) * 100);
  });

  // Real bookings-per-day count for the last 7 days.
  const trend = [];
  const now = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - offset);
    const key = isoOf(day);
    trend.push({
      date: key,
      count: ranged.filter((booking) => booking.date === key).length,
    });
  }
  // The bar chart scales off this instead of the old `count * 10` fudge, which
  // pinned every bar to full height once a day reached 10 bookings.
  const trendMax = Math.max(1, ...trend.map((point) => point.count));

  // -------------------------------------------------------------------------
  // Revenue over the SELECTED range, split by whether the money actually
  // arrived. This is the "collection gap": what was booked versus what was
  // paid for. A tall outstanding line under a flat collected line means courts
  // are reserved but the money never came in.
  // -------------------------------------------------------------------------
  const byDate = new Map();
  ranged.forEach((booking) => {
    const key = booking.date;
    if (!key) return;
    const entry = byDate.get(key) || { date: key, collected: 0, outstanding: 0, bookings: 0 };
    const amount = Number(booking.amount) || 0;
    entry.bookings += 1;
    if (booking.paymentStatus === "paid") entry.collected += amount;
    else entry.outstanding += amount;
    byDate.set(key, entry);
  });

  // Every day in range, so a quiet day is a visible dip rather than a
  // missing point (a line that skips empty days reads as "no data").
  const days = eachDay(filters.from, filters.to);
  const revenueTrend = days.length
    ? days.map(
        (date) =>
          byDate.get(date) || { date, collected: 0, outstanding: 0, bookings: 0 },
      )
    : [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const bookedRevenue = revenueTrend.reduce(
    (sum, point) => sum + point.collected + point.outstanding,
    0,
  );
  const collectedTotal = revenueTrend.reduce((sum, p) => sum + p.collected, 0);
  const outstandingTotal = revenueTrend.reduce((sum, p) => sum + p.outstanding, 0);

  // -------------------------------------------------------------------------
  // When are courts actually wanted? An hour-by-hour demand profile exposes the
  // dead slots an owner can promote (or staff down) instead of guessing.
  // -------------------------------------------------------------------------
  const HOURS = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${((hour + 11) % 12) + 1}${hour < 12 ? "am" : "pm"}`,
    bookings: 0,
    revenue: 0,
  }));
  ranged.forEach((booking) => {
    const hour = hourOf(booking.time);
    if (hour === null) return;
    HOURS[hour].bookings += 1;
    HOURS[hour].revenue += Number(booking.amount) || 0;
  });
  // Trim to the hours the facility is actually used, so the strip is not mostly
  // empty night-time columns.
  const usedHours = HOURS.filter((slot) => slot.bookings > 0);
  const firstUsed = usedHours.length ? usedHours[0].hour : 6;
  const lastUsed = usedHours.length ? usedHours[usedHours.length - 1].hour : 22;
  const hourlyDemand = HOURS.slice(
    Math.max(0, Math.min(firstUsed, 6)),
    Math.min(24, Math.max(lastUsed, 22) + 1),
  );
  const hourMax = Math.max(1, ...hourlyDemand.map((slot) => slot.bookings));

  // Which weekday is busiest? Answers "do we need staff on Sundays?".
  const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekdayLoad = WEEKDAYS.map((label) => ({ label, bookings: 0, revenue: 0 }));
  ranged.forEach((booking) => {
    if (!booking.date) return;
    const index = mondayIndex(booking.date);
    if (index < 0 || index > 6) return;
    weekdayLoad[index].bookings += 1;
    weekdayLoad[index].revenue += Number(booking.amount) || 0;
  });
  const weekdayMax = Math.max(1, ...weekdayLoad.map((day) => day.bookings));

  // Cancelled courts are capacity the owner gave away; a high cancelled count
  // against flat revenue is usually a no-show / double-booking problem.
  const cancelledRevenue = ranged
    .filter((item) => item.status === "cancelled")
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  // Average per booking, and the busiest single day in the range.
  const busiestDay = revenueTrend.reduce(
    (best, point) => (point.bookings > best.bookings ? point : best),
    { date: null, bookings: 0, collected: 0, outstanding: 0 },
  );

  return {
    total: ranged.length,
    confirmed: ranged.filter((item) => item.status === "confirmed").length,
    completed: ranged.filter((item) => item.status === "completed").length,
    cancelled: ranged.filter((item) => item.status === "cancelled").length,
    pending: ranged.filter((item) => item.status === "pending").length,
    revenue: ranged.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    paidRevenue: paid.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    pendingRevenue: pending.reduce(
      (sum, item) => sum + (Number(item.amount) || 0),
      0,
    ),
    courtPerformance,
    trend,
    trendMax,
    // Collection gap: booked vs collected over the selected range.
    revenueTrend,
    bookedRevenue,
    collectedTotal,
    outstandingTotal,
    collectionRate: bookedRevenue
      ? Math.round((collectedTotal / bookedRevenue) * 100)
      : 0,
    cancelledRevenue,
    avgPerBooking: ranged.length
      ? Math.round(
          (ranged.reduce((sum, item) => sum + (Number(item.amount) || 0), 0) /
            ranged.length) * 100,
        ) / 100
      : 0,
    busiestDay,
    hourlyDemand,
    hourMax,
    weekdayLoad,
    weekdayMax,
    rows: ranged,
  };
}
export const reportService = { getReport };
