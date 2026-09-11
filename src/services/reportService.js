import { bookingService } from "./bookingService";

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
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    trend.push({
      date: key,
      count: ranged.filter((booking) => booking.date === key).length,
    });
  }

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
    rows: ranged,
  };
}
export const reportService = { getReport };
