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
  const [cancelError, setCancelError] = useState("");
  const [payingId, setPayingId] = useState("");
  // Guards the settle-poll so a re-render cannot start a second loop.
  const settlePollRef = useRef(false);

  // After returning from a PayMongo redirect (?paid=1) the webhook is usually a
  // second or two behind, so poll the authoritative booking state until it
  // flips to PAID + CONFIRMED, then refetch the rows. The redirect itself is
  // never treated as proof of payment.
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
    let attempts = 0;
    const target = unpaid[0];

    const timer = setInterval(async () => {
      attempts += 1;
      if (cancelled || attempts > 20) {
        clearInterval(timer);
        return;
      }
      try {
        const state = await bookingPaymentService.getBookingPaymentStatus({
          bookingNumber: target.id,
        });
        if (cancelled) return;
        if (state.paymentStatus === "paid") {
          clearInterval(timer);
          setNotice(true);
          // Re-read through the hook so the table shows the settled state.
          await refetch();
        }
      } catch {
        // Transient (offline / cold start): keep polling until the budget ends.
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(timer);
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
