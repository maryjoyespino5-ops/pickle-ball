import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reports page exists to answer two questions an owner actually has:
 *   1. How much money is booked but NOT yet collected? ("the collection gap")
 *   2. Which court slots actually sell, and which sit empty?
 *
 * These pin the aggregation. A wrong number here is worse than no chart: an
 * owner would make pricing and staffing decisions from it.
 */

const { getAllBookingsMock } = vi.hoisted(() => ({
  getAllBookingsMock: vi.fn(),
}));

vi.mock("./bookingService", () => ({
  bookingService: { getAllBookings: getAllBookingsMock },
}));

import { getReport } from "./reportService";

const mk = (over = {}) => ({
  id: "RB-1",
  courtId: "c1",
  courtName: "Court 1",
  date: "2026-09-10",
  time: "09:00",
  duration: 1,
  amount: 300,
  status: "completed",
  paymentStatus: "paid",
  isPaid: true,
  isConfirmed: true,
  ...over,
});

describe("report analytics", () => {
  // 2026-09-10 is a Thursday, 2026-09-11 a Friday.
  const bookings = [
    mk({ id: "RB-1", amount: 300, paymentStatus: "paid" }),
    mk({ id: "RB-2", amount: 600, paymentStatus: "pending" }),
    mk({ id: "RB-3", amount: 300, paymentStatus: "paid", time: "19:00" }),
    mk({
      id: "RB-4",
      amount: 300,
      status: "cancelled",
      paymentStatus: "pending",
      date: "2026-09-11",
    }),
  ];

  let report;
  beforeEach(async () => {
    getAllBookingsMock.mockReset();
    getAllBookingsMock.mockResolvedValue(bookings);
    report = await getReport({ from: "2026-09-10", to: "2026-09-11" });
  });

  it("splits booked money into collected and outstanding", () => {
    expect(report.collectedTotal).toBe(600);
    expect(report.outstandingTotal).toBe(900);
    expect(report.bookedRevenue).toBe(1500);
  });

  it("always reconciles: collected + outstanding === booked", () => {
    // The gap is a difference, so it must never drift into its own total.
    expect(report.collectedTotal + report.outstandingTotal).toBe(
      report.bookedRevenue,
    );
  });

  it("reports a collection rate as a whole percentage", () => {
    expect(report.collectionRate).toBe(40); // 600 of 1500
  });

  it("emits a point for every day in range, including empty ones", () => {
    // A day with no bookings must read as a dip, not vanish from the line.
    expect(report.revenueTrend.map((p) => p.date)).toEqual([
      "2026-09-10",
      "2026-09-11",
    ]);
    const day10 = report.revenueTrend[0];
    expect(day10.collected).toBe(600);
    expect(day10.outstanding).toBe(600);
  });

  it("buckets demand by hour and keeps the busiest hour as the max", () => {
    // RB-1, RB-2 and RB-4 all start at 09:00; RB-3 starts at 19:00.
    const byHour = Object.fromEntries(
      report.hourlyDemand.map((slot) => [slot.hour, slot.bookings]),
    );
    expect(byHour[9]).toBe(3);
    expect(byHour[19]).toBe(1);
    expect(report.hourMax).toBe(3);
  });

  it("keeps every booking accounted for in the weekday breakdown", () => {
    const summed = report.weekdayLoad.reduce((s, d) => s + d.bookings, 0);
    expect(summed).toBe(bookings.length);
  });

  it("surfaces cancelled court time as given-up revenue", () => {
    expect(report.cancelledRevenue).toBe(300);
  });

  it("counts an unparseable time in totals without crashing the hour buckets", async () => {
    getAllBookingsMock.mockResolvedValue([mk({ id: "RB-9", time: "n/a" })]);
    const messy = await getReport({ from: "2026-09-10", to: "2026-09-11" });
    expect(messy.total).toBe(1);
    expect(messy.hourlyDemand.every((slot) => slot.bookings === 0)).toBe(true);
  });

  it("returns an empty, non-crashing report for an empty range", async () => {
    getAllBookingsMock.mockResolvedValue([]);
    const empty = await getReport({ from: "2026-09-10", to: "2026-09-11" });
    expect(empty.total).toBe(0);
    // 0, not NaN — a NaN rate would render as "NaN%" on the page.
    expect(empty.collectionRate).toBe(0);
    expect(empty.bookedRevenue).toBe(0);
    expect(empty.avgPerBooking).toBe(0);
  });

  it("reads a 12-hour time as well as a 24-hour one", async () => {
    getAllBookingsMock.mockResolvedValue([
      mk({ id: "RB-A", time: "9:00 AM" }),
      mk({ id: "RB-B", time: "7:00 PM" }),
    ]);
    const result = await getReport({ from: "2026-09-10", to: "2026-09-10" });
    const byHour = Object.fromEntries(
      result.hourlyDemand.map((slot) => [slot.hour, slot.bookings]),
    );
    expect(byHour[9]).toBe(1);
    expect(byHour[19]).toBe(1);
  });
});
