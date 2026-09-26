// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * Render tests for the surfaces where the GCash payment step was wired in:
 *   * BookingTable shows "Pay with GCash" only for unpaid open bookings.
 *   * ManageBooking offers payment for token-holding guests and runs the
 *     ?paid=1 poll loop until the webhook's verdict arrives.
 */

// vi.mock factories are hoisted above imports, so the spies must be created
// via vi.hoisted to be available when the factory runs.
const { startBookingCheckoutMock, waitForBookingPaymentMock } = vi.hoisted(
  () => ({
    startBookingCheckoutMock: vi.fn(),
    waitForBookingPaymentMock: vi.fn(),
  }),
);

vi.mock("../services/bookingPaymentService", async (importOriginal) => {
  const actual = await importOriginal();
  // ManageBooking calls through the bookingPaymentService OBJECT, not the
  // named exports, so the object must be rebuilt around the same spies too.
  return {
    ...actual,
    startBookingCheckout: startBookingCheckoutMock,
    waitForBookingPayment: waitForBookingPaymentMock,
    bookingPaymentService: {
      ...actual.bookingPaymentService,
      startBookingCheckout: startBookingCheckoutMock,
      waitForBookingPayment: waitForBookingPaymentMock,
    },
  };
});

import { BookingTable } from "../components/dashboard/BookingTable";
import {
  startBookingCheckout,
  waitForBookingPayment,
} from "../services/bookingPaymentService";
import { ManageBooking } from "../pages/public/ManageBooking";
import { guestBookingService } from "../services/guestBookingService";

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BookingTable pay action", () => {
  const base = {
    courtName: "Court 1",
    date: "2026-10-01",
    time: "09:00",
    duration: 1,
    amount: 300,
    status: "pending",
  };

  it("shows Pay with GCash for an unpaid pending booking", () => {
    render(
      <BookingTable
        bookings={[{ ...base, id: "RB-1", paymentStatus: "pending" }]}
        onPay={vi.fn()}
      />,
    );
    expect(screen.getByText("Pay with GCash")).toBeTruthy();
  });

  it("hides the pay button once the booking is paid", () => {
    render(
      <BookingTable
        bookings={[{ ...base, id: "RB-1", paymentStatus: "paid" }]}
        onPay={vi.fn()}
      />,
    );
    expect(screen.queryByText("Pay with GCash")).toBeNull();
    expect(screen.getByText("Cancel")).toBeTruthy(); // cancel still available
  });

  it("calls onPay with the booking reference when enabled, and disables while paying", () => {
    const onPay = vi.fn();
    const { rerender } = render(
      <BookingTable
        bookings={[{ ...base, id: "RB-2", paymentStatus: "pending" }]}
        onPay={onPay}
      />,
    );
    fireEvent.click(screen.getByText("Pay with GCash"));
    expect(onPay).toHaveBeenCalledWith("RB-2");

    // While paying, the button shows the busy copy and is disabled.
    rerender(
      <BookingTable
        bookings={[{ ...base, id: "RB-2", paymentStatus: "pending" }]}
        onPay={onPay}
        payingId="RB-2"
      />,
    );
    const busy = screen.getByText("Opening GCash...");
    expect(busy.disabled).toBe(true);
  });

  it("shows no pay button without an onPay handler", () => {
    render(
      <BookingTable
        bookings={[{ ...base, id: "RB-3", paymentStatus: "pending" }]}
      />,
    );
    expect(screen.queryByText("Pay with GCash")).toBeNull();
  });

  // A GCash payment settles the MONEY, not the game (migration 0029). The
  // booking status is therefore a separate column and stays 'pending' while
  // the payment status reads 'paid' — these two must never be conflated into
  // one "Paid · Confirmed" badge.
  it("shows paid in the payment column and pending in the booking column", () => {
    render(
      <BookingTable
        bookings={[
          {
            ...base,
            id: "RB-4",
            status: "pending",
            paymentStatus: "paid",
            isPaid: true,
            isConfirmed: false,
          },
        ]}
        onPay={vi.fn()}
      />,
    );
    const headerCells = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(headerCells).toContain("Booking status");
    expect(headerCells).toContain("Payment status");

    const row = screen.getByText("RB-4").closest("tr");
    expect(within(row).getByText("paid")).toBeTruthy();
    expect(within(row).getByText("pending")).toBeTruthy();
    // The old combined badge is gone, and a settled booking offers no action.
    expect(screen.queryByText(/Paid\s*·\s*Confirmed/)).toBeNull();
    expect(screen.queryByText("Pay with GCash")).toBeNull();
  });

  it("does not show a payment status of paid while the payment is pending", () => {
    render(
      <BookingTable
        bookings={[
          {
            ...base,
            id: "RB-5",
            status: "pending",
            paymentStatus: "pending",
            isPaid: false,
            isConfirmed: false,
          },
        ]}
        onPay={vi.fn()}
      />,
    );
    expect(screen.queryByText("paid")).toBeNull();
  });

  // A paid booking can be paid two genuinely different ways, and the wording has
  // to say which. These pin the exact strings the player sees.
  it("names GCash when the player paid online", () => {
    render(
      <BookingTable
        bookings={[
          {
            ...base,
            id: "RB-6",
            paymentStatus: "paid",
            paymentMethod: "GCash",
            isPaid: true,
          },
        ]}
      />,
    );
    const row = screen.getByText("RB-6").closest("tr");
    expect(within(row).getByText("Paid · GCash")).toBeTruthy();
    // The status pill stays, so the column still reads as a status column.
    expect(within(row).getByText("paid")).toBeTruthy();
  });

  it("names Pay at Court when an admin recorded cash at the desk", () => {
    render(
      <BookingTable
        bookings={[
          {
            ...base,
            id: "RB-7",
            paymentStatus: "paid",
            paymentMethod: "Pay at Court",
            isPaid: true,
          },
        ]}
      />,
    );
    const row = screen.getByText("RB-7").closest("tr");
    expect(within(row).getByText("Paid · Pay at Court")).toBeTruthy();
    // The two cases must never be collapsed into the same word.
    expect(within(row).queryByText("Paid · GCash")).toBeNull();
  });

  it("claims no method while the payment is still pending", () => {
    render(
      <BookingTable
        bookings={[
          {
            ...base,
            id: "RB-8",
            paymentStatus: "pending",
            paymentMethod: "GCash",
            isPaid: false,
          },
        ]}
        onPay={vi.fn()}
      />,
    );
    const row = screen.getByText("RB-8").closest("tr");
    // Nothing has been collected, so no "Paid · ..." badge may appear.
    expect(within(row).queryByText(/^Paid ·/)).toBeNull();
    // Scope to the payment cell by its data-label: the booking-status column
    // also reads "pending", so a bare text query would match both.
    const paymentCell = row.querySelector('[data-label="Payment status"]');
    expect(paymentCell).toBeTruthy();
    expect(paymentCell.textContent).toContain("pending");
    expect(paymentCell.textContent).not.toContain("GCash");
  });
});

describe("ManageBooking GCash step", () => {
  const guestBooking = {
    reference: "RB-G-1",
    courtName: "Court 1",
    date: "2026-10-01",
    time: "09:00",
    duration: 2,
    amount: 600,
    status: "pending",
    paymentStatus: "pending",
    customerName: "Juan",
    customerPhone: "0917",
    isClaimed: false,
  };

  function renderPage(search = "?t=secret") {
    // The page must live inside a real <Route> — it reads the reference from
    // useParams(), which is empty outside one.
    return render(
      <MemoryRouter initialEntries={[`/booking/RB-G-1${search}`]}>
        <Routes>
          <Route path="/booking/:reference" element={<ManageBooking />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("offers GCash payment to a guest holding the secure token", async () => {
    vi.spyOn(guestBookingService, "getGuestBooking").mockResolvedValue(
      guestBooking,
    );
    renderPage();

    const payButton = await screen.findByText(/Pay ₱600 with GCash/);
    expect(payButton).toBeTruthy();
  });

  it("hides the payment box for a paid booking", async () => {
    vi.spyOn(guestBookingService, "getGuestBooking").mockResolvedValue({
      ...guestBooking,
      paymentStatus: "paid",
      // 0023: the RPC returns the settled method, so the page names HOW it was
      // paid ("Paid · GCash") instead of a static label. The separator is the
      // same middot every other view uses, so the wording is identical on the
      // guest page, the player tables and the admin tables.
      paymentMethod: "GCash",
      isPaid: true,
      isConfirmed: true,
    });
    renderPage();
    expect(await screen.findByText("Paid · GCash")).toBeTruthy();
    expect(
      screen.getByText(/Booking confirmed · Payment received/),
    ).toBeTruthy();
    expect(screen.queryByText(/Pay ₱600 with GCash/)).toBeNull();
  });

  it("redirects to the PayMongo checkout URL when the guest presses pay", async () => {
    vi.spyOn(guestBookingService, "getGuestBooking").mockResolvedValue(
      guestBooking,
    );
    startBookingCheckoutMock.mockResolvedValue({
      checkoutUrl: "https://paymongo.test/checkout/cs_1",
      sessionId: "cs_1",
      amount: 600,
    });
    // jsdom refuses to redefine window.location; delete it first, then swap
    // in a plain object whose href setter records the redirect target.
    const originalHref = window.location.href;
    delete window.location;
    let navigatedTo = "";
    window.location = {
      get href() {
        return originalHref;
      },
      set href(v) {
        navigatedTo = v;
      },
    };
    renderPage();

    fireEvent.click(await screen.findByText(/Pay ₱600 with GCash/));
    expect(startBookingCheckoutMock).toHaveBeenCalledWith({
      bookingNumber: "RB-G-1",
      guestToken: "secret",
    });
    // The redirect happens one microtask after the click (the mocked checkout
    // promise resolves first), so wait for it rather than asserting inline.
    await waitFor(() =>
      expect(navigatedTo).toBe("https://paymongo.test/checkout/cs_1"),
    );
  });

  it("after the ?paid=1 redirect, polls until the webhook commits and refreshes", async () => {
    vi.spyOn(guestBookingService, "getGuestBooking")
      .mockResolvedValueOnce(guestBooking) // first open
      .mockResolvedValue({ ...guestBooking, paymentStatus: "paid" }); // after refresh
    waitForBookingPayment.mockResolvedValue({
      paid: true,
      state: { paymentStatus: "paid", bookingStatus: "confirmed" },
    });
    renderPage("?t=secret&paid=1");

    // The success notice comes from the poll result, not the redirect.
    expect(
      await screen.findByText(/Payment received — your booking is confirmed/),
    ).toBeTruthy();
    expect(waitForBookingPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingNumber: "RB-G-1",
        guestToken: "secret",
      }),
    );
  });

  it("does not poll on a normal visit (no ?paid=1)", async () => {
    vi.spyOn(guestBookingService, "getGuestBooking").mockResolvedValue(
      guestBooking,
    );
    renderPage();
    await screen.findByText(/Pay ₱600 with GCash/);
    expect(waitForBookingPayment).not.toHaveBeenCalled();
  });
});
