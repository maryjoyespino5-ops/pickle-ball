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
  getAllBookings,
  getMyBookings,
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

/**
 * The payment METHOD on a booking.
 *
 * Method and status are reported separately — the table renders them as two
 * columns, never a combined "Paid · GCash" cell.
 *
 * Both booking mappers used `row.payments?.[0]`, but PostgREST returns a
 * one-to-one embed (bookings -> payments) as a plain OBJECT, not an array. The
 * index read was therefore always undefined: the admin mapper silently fell
 * back to "Pay at Court" and mislabelled every real GCash payment, while the
 * player mapper had no method at all. These pin both embed shapes.
 */
describe("payment method on a booking", () => {
  const withPayments = (payments) => ({ ...bookingRow, payments });

  /** Row-list response; the mappers call .map() on the result. */
  const rowsWith = (payments) => [withPayments(payments)];

  it("reads the method when PostgREST embeds payments as an OBJECT", async () => {
    // This is the real shape returned by the live API for bookings -> payments.
    fromMock.mockImplementation((table) =>
      query(
        table === "profiles"
          ? { data: [], error: null }
          : { data: rowsWith({ method: "GCash" }), error: null },
      ),
    );

    const [player] = await getMyBookings();
    expect(player.paymentMethod).toBe("GCash");
  });

  it("reads the method when PostgREST embeds payments as an ARRAY", async () => {
    fromMock.mockImplementation((table) =>
      query(
        table === "profiles"
          ? { data: [], error: null }
          : { data: rowsWith([{ method: "GCash" }]), error: null },
      ),
    );

    const [player] = await getMyBookings();
    expect(player.paymentMethod).toBe("GCash");
  });

  it("keeps a desk payment labelled 'Pay at Court'", async () => {
    fromMock.mockImplementation((table) =>
      query(
        table === "profiles"
          ? { data: [], error: null }
          : { data: rowsWith({ method: "Pay at Court" }), error: null },
      ),
    );

    const [player] = await getMyBookings();
    expect(player.paymentMethod).toBe("Pay at Court");
  });

  it("claims no method on the player booking when there is no payment row", async () => {
    fromMock.mockImplementation((table) =>
      query(
        table === "profiles"
          ? { data: [], error: null }
          : { data: rowsWith(null), error: null },
      ),
    );

    const [player] = await getMyBookings();
    // Must NOT default to "Pay at Court" here: nothing has been collected, so
    // naming a method would be a lie. The badge only renders once paid anyway.
    expect(player.paymentMethod).toBe("");
  });

  it("reports GCash to the admin too, not a silent 'Pay at Court' fallback", async () => {
    fromMock.mockImplementation((table) =>
      query(
        table === "profiles"
          ? { data: [], error: null }
          : { data: rowsWith({ method: "GCash" }), error: null },
      ),
    );

    const [adminBooking] = await getAllBookings();
    expect(adminBooking.paymentMethod).toBe("GCash");
  });
});
