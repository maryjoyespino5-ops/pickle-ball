import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards for the simplified booking lifecycle (migration 0024).
 *
 * The client used to expose "Confirm" and "Mark completed". Both are gone: a
 * verified GCash payment confirms a booking server-side and
 * complete_past_bookings() completes it once its slot ends. These tests pin the
 * two things the browser is still responsible for — refusing a stray
 * confirm/complete write, and going through the database RPCs for the actions
 * that remain (cancel, run the completion pass).
 */

const { rpcMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: rpcMock, from: fromMock },
}));

import {
  adminCancelBooking,
  completePastBookings,
  updateBooking,
} from "./bookingService";

/** Minimal thenable query builder: answers whichever chain the service uses. */
function query(result) {
  const self = {
    select: () => self,
    update: () => self,
    eq: () => self,
    neq: () => self,
    order: () => self,
    or: () => self,
    range: () => self,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return self;
}

const bookingRow = {
  id: "uuid-1",
  booking_number: "RB-1",
  user_id: null,
  court_id: "court-1",
  paddle_id: null,
  booking_date: "2026-10-01",
  start_time: "09:00:00",
  duration_hours: 1,
  amount: 300,
  status: "pending",
  payment_status: "paid",
  created_at: "2026-09-20T00:00:00.000Z",
  courts: { name: "Court 1" },
  paddles: null,
  payments: [],
};

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  fromMock.mockImplementation((table) =>
    query(
      table === "profiles" ? { data: [], error: null } : { data: bookingRow, error: null },
    ),
  );
});

describe("updateBooking status guard", () => {
  it("refuses a manual confirm or complete write", async () => {
    await expect(updateBooking("RB-1", { status: "confirmed" })).rejects.toThrow(
      /automatic/,
    );
    await expect(updateBooking("RB-1", { status: "completed" })).rejects.toThrow(
      /automatic/,
    );
    // The guard runs before any query, so nothing was written.
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("still records a Pay-at-Court payment", async () => {
    const booking = await updateBooking("RB-1", { paymentStatus: "paid" });
    expect(booking.paymentStatus).toBe("paid");
    expect(fromMock).toHaveBeenCalledWith("bookings");
  });
});

describe("adminCancelBooking", () => {
  it("cancels through the database RPC and returns the refreshed row", async () => {
    rpcMock.mockResolvedValue({ data: "cancelled", error: null });

    const booking = await adminCancelBooking("RB-1");

    expect(rpcMock).toHaveBeenCalledWith("admin_cancel_booking", {
      p_booking_number: "RB-1",
    });
    expect(booking.id).toBe("RB-1");
  });

  it("surfaces the server's refusal (not an admin, or already cancelled)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("Only an administrator can cancel a booking."),
    });
    await expect(adminCancelBooking("RB-1")).rejects.toThrow(/administrator/);
  });

  it("requires a booking reference", async () => {
    await expect(adminCancelBooking("")).rejects.toThrow(/reference/);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("completePastBookings", () => {
  it("runs the automatic completion pass and returns the count", async () => {
    rpcMock.mockResolvedValue({ data: 3, error: null });
    await expect(completePastBookings()).resolves.toBe(3);
    expect(rpcMock).toHaveBeenCalledWith("complete_past_bookings");
  });

  it("treats a null result as zero rows advanced", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(completePastBookings()).resolves.toBe(0);
  });

  it("propagates a missing-function error so callers stay best-effort", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("function public.complete_past_bookings() does not exist"),
    });
    await expect(completePastBookings()).rejects.toThrow(/does not exist/);
  });
});
