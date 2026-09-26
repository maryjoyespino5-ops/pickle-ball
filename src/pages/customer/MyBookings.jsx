import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { BookingTable } from "../../components/dashboard/BookingTable";
import { useBookings } from "../../hooks/useBookings";
import { bookingPaymentService } from "../../services/bookingPaymentService";
import { subscriptionService } from "../../services/subscriptionService";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { useAutoDismiss } from "../../hooks/useAutoDismiss";
import { CANCELLABLE_STATUSES } from "../../lib/constants";
export function MyBookings() {
  const { bookings, loading, error, cancel, refetch } = useBookings();
  useScrollReveal();
  const location = useLocation();
  const [justBooked, setJustBooked] = useState(() =>
    Boolean(location.state?.justBooked),
  );
  const [notice, setNotice] = useState(false);
  // Separate from `notice` (which means "booking cancelled"): a settled payment
  // must never render the cancellation copy.
  const [paidNotice, setPaidNotice] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [payingId, setPayingId] = useState("");
  // Guards the settle-poll so a re-render cannot start a second loop.
  const settlePollRef = useRef(false);

  // After returning from a PayMongo redirect (?paid=1) the webhook is usually a
  // second or two behind, so poll the authoritative booking state until it
  // flips to PAID, then refetch the rows. The redirect itself is never treated
  // as proof of payment.
  //
  // waitForBookingPayment is used (not a bare getBookingPaymentStatus read)
  // because it also calls paymongo-verify, which asks PayMongo directly and
  // commits through confirm_booking_from_paymongo. That self-heals a payment
  // whose webhook delivery never arrived, instead of leaving the player staring
  // at "pending" until the browser is closed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") !== "1") return;
    if (settlePollRef.current) return;
    const unpaid = bookings.filter(
      (booking) => booking.paymentStatus !== "paid",
    );
    if (unpaid.length === 0) return;

    settlePollRef.current = true;
    let cancelled = false;
    // Poll the booking that was actually paid for. The PayMongo return URL
    // carries the reference (?booking=RB-...); fall back to the oldest unpaid
    // row only when it is absent.
    const fromUrl = params.get("booking") || "";
    const target =
      unpaid.find((booking) => booking.id === fromUrl) || unpaid[unpaid.length - 1];

    bookingPaymentService
      .waitForBookingPayment({
        bookingNumber: target.id,
        timeoutMs: 90000,
        intervalMs: 3000,
      })
      .then(({ paid }) => {
        if (cancelled || !paid) return;
        setPaidNotice(true);
        // Re-read through the hook so the table shows the settled state.
        refetch();
      });

    return () => {
      cancelled = true;
    };
  }, [bookings, refetch]);

  // Signed-in owner pays without a token: the Edge Function resolves the caller
  // from the Authorization header. Confirmation only ever arrives via the
  // signed PayMongo webhook — this redirect merely STARTS the payment.
  const handlePay = async (bookingNumber) => {
    setPayingId(bookingNumber);
    setCancelError("");
    try {
      const { checkoutUrl } = await bookingPaymentService.startBookingCheckout({
        bookingNumber,
      });
      window.location.href = checkoutUrl;
    } catch (err) {
      setCancelError(
        err?.message || "Could not start the GCash payment. Please try again.",
      );
      setPayingId("");
    }
  };
  // Success notices auto-dismiss after a few seconds (B30).
  useAutoDismiss(justBooked, () => setJustBooked(false));
  useAutoDismiss(notice, () => setNotice(false));
  const handleCancel = async (id) => {
    setCancelError("");
    try {
      await cancel(id);
      setNotice(true);
    } catch (err) {
      setCancelError(
        subscriptionService.customerSubscriptionMessage(
          err,
          "Could not cancel the booking.",
        ),
      );
    }
  };
  return (
    <main className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR PICKLEBALL</span>
          <h1>My bookings</h1>
          <p>Keep track of every hour you have reserved.</p>
        </div>
        <Button to="/book">
          Book a court <span aria-hidden="true">-&gt;</span>
        </Button>
      </div>
      {justBooked && (
        <div className="success-message">Your court is booked. See you on court!</div>
      )}
      {notice && (
        <div className="success-message">Booking cancelled successfully.</div>
      )}
      {paidNotice && (
        <div className="success-message">
          Payment received — your GCash payment is confirmed.
        </div>
      )}
      {cancelError && <ErrorMessage message={cancelError} />}
      {loading ? (
        <p className="loading-state">Loading bookings...</p>
      ) : (
        <BookingTable
          bookings={bookings.filter((booking) =>
            CANCELLABLE_STATUSES.includes(booking.status),
          )}
          onCancel={handleCancel}
          onPay={handlePay}
          payingId={payingId}
        />
      )}
    </main>
  );
}
