import { bookingService } from "./bookingService";
export async function getReport(filters = {}) {
  let bookings = await bookingService.getAllBookings({
    court: filters.court || "all",
    status: filters.status || "all",
    paymentStatus: filters.paymentStatus || "all",
  });
  if (filters.from)
    bookings = bookings.filter((booking) => booking.date >= filters.from);
  if (filters.to)
    bookings = bookings.filter((booking) => booking.date <= filters.to);
  const paid = bookings.filter((item) => item.paymentStatus === "paid");
  const pending = bookings.filter((item) => item.paymentStatus === "pending");
  return {
    total: bookings.length,
    confirmed: bookings.filter((item) => item.status === "confirmed").length,
    completed: bookings.filter((item) => item.status === "completed").length,
    cancelled: bookings.filter((item) => item.status === "cancelled").length,
    pending: bookings.filter((item) => item.status === "pending").length,
    revenue: bookings.reduce((sum, item) => sum + item.amount, 0),
    paidRevenue: paid.reduce((sum, item) => sum + item.amount, 0),
    pendingRevenue: pending.reduce((sum, item) => sum + item.amount, 0),
    courtPerformance: [
      {
        name: "Court 1",
        bookings: bookings.filter((item) => item.courtId === "court-1").length,
      },
      {
        name: "Court 2",
        bookings: bookings.filter((item) => item.courtId === "court-2").length,
      },
    ],
    trend: bookings.length
      ? [3, 5, 4, 7, 6, 8, Math.min(9, bookings.length)]
      : [0, 0, 0, 0, 0, 0, 0],
    rows: bookings,
  };
}
export const reportService = { getReport };
