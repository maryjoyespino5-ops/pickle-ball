// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminBookingTable } from "./AdminBookingTable";

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
