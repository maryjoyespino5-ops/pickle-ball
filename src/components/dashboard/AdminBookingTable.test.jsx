// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminBookingTable } from "./AdminBookingTable";
import { BookingDetails } from "../booking/BookingDetails";

/**
 * The simplified lifecycle (migration 0024) removed the manual "Confirm" and
 * "Complete" actions: a verified GCash payment confirms a booking and
 * complete_past_bookings() completes it once the slot ends. What an admin can
 * still do from the table is reschedule an open booking or cancel one.
 */

const booking = {
  id: "RB-1",
  customer: "Juan",
  email: "juan@example.com",
  phone: "",
  isGuest: false,
  courtName: "Court 1",
  date: "2026-10-01",
  time: "09:00",
  duration: 1,
  amount: 300,
  status: "pending",
  paymentStatus: "pending",
};

afterEach(cleanup);

describe("AdminBookingTable actions", () => {
  it("never offers Confirm or Complete", () => {
    render(<AdminBookingTable bookings={[booking]} />);
    expect(screen.queryByText("Confirm")).toBeNull();
    expect(screen.queryByText("Complete")).toBeNull();
  });

  it("offers Reschedule and Cancel for a pending booking", () => {
    const onReschedule = vi.fn();
    const onCancel = vi.fn();
    render(
      <AdminBookingTable
        bookings={[booking]}
        onReschedule={onReschedule}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText("Reschedule"));
    expect(onReschedule).toHaveBeenCalledWith(booking);

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledWith(booking);
  });

  it("keeps Reschedule for a confirmed booking and drops it once completed", () => {
    const { rerender } = render(
      <AdminBookingTable bookings={[{ ...booking, status: "confirmed" }]} />,
    );
    expect(screen.getByText("Reschedule")).toBeTruthy();

    rerender(
      <AdminBookingTable bookings={[{ ...booking, status: "completed" }]} />,
    );
    expect(screen.queryByText("Reschedule")).toBeNull();
    // Cancelling is still offered: the RPC only refuses an already cancelled
    // booking, and a completed one may need its payment refunded.
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("renders read-only rows without the action buttons", () => {
    render(<AdminBookingTable bookings={[booking]} readOnly />);
    expect(screen.getByText("View")).toBeTruthy();
    expect(screen.queryByText("Reschedule")).toBeNull();
    expect(screen.queryByText("Cancel")).toBeNull();
  });
});

/**
 * Task 5: a GCash payment settles itself. Nothing in the admin UI may offer to
 * hand-mark one paid, because that money moved through PayMongo — a manual
 * "paid" would be a booking that was never paid for.
 */
describe("BookingDetails payment actions", () => {
  it("offers Mark paid for an unpaid Pay-at-Court booking", () => {
    render(
      <BookingDetails
        booking={{ ...booking, paymentMethod: "Pay at Court" }}
        onAction={vi.fn()}
        onReschedule={vi.fn()}
      />,
    );
    expect(screen.getByText("Mark paid")).toBeTruthy();
  });

  it("never offers Mark paid for an unpaid GCash booking", () => {
    render(
      <BookingDetails
        booking={{ ...booking, paymentMethod: "GCash" }}
        onAction={vi.fn()}
        onReschedule={vi.fn()}
      />,
    );
    expect(screen.queryByText("Mark paid")).toBeNull();
  });

  it("keeps booking status and payment status as separate concerns", () => {
    render(
      <BookingDetails
        booking={{
          ...booking,
          status: "pending",
          paymentStatus: "paid",
          paymentMethod: "GCash",
        }}
        onAction={vi.fn()}
        onReschedule={vi.fn()}
      />,
    );
    // Paid money, game still upcoming: both facts are shown independently and
    // the combined "Paid · Confirmed" badge must not come back.
    expect(screen.getByText("paid")).toBeTruthy();
    expect(screen.getByText("pending")).toBeTruthy();
    expect(screen.queryByText(/Paid\s*·\s*Confirmed/)).toBeNull();
    expect(screen.queryByText("Mark paid")).toBeNull();
  });
});
