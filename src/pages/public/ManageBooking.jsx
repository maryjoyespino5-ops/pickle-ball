import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { guestBookingService } from "../../services/guestBookingService";
import { subscriptionService } from "../../services/subscriptionService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12 } from "../../utils/dateUtils";
import { useAuth } from "../../hooks/useAuth";
import { useScrollReveal } from "../../hooks/useScrollReveal";

/**
 * Public booking page: /booking/:reference?t=<secure token>
 *
 * The secure token (inside the QR code / confirmation link) authorises exactly
 * one booking. A guest who lost the link can still recover it with the booking
 * reference + the mobile number they booked with — nothing else opens a
 * booking, and RLS keeps every other customer's booking invisible.
 */
export function ManageBooking() {
  const { reference: routeReference } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t") || "";
  const navigate = useNavigate();
  const { user } = useAuth();
  useScrollReveal();

  const [booking, setBooking] = useState(null);
  const [reference, setReference] = useState(routeReference || "");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(Boolean(routeReference && token));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const openBooking = useCallback(async (ref, secureToken) => {
    setLoading(true);
    setError("");
    try {
      const found = await guestBookingService.getGuestBooking(ref, secureToken);
      setBooking(found);
      if (!found) {
        setError(
          "We could not find that booking. Check your link or search below.",
        );
      }
    } catch (err) {
      setError(
        subscriptionService.customerSubscriptionMessage(
          err,
          "We could not open that booking. Try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (routeReference && token) {
      openBooking(routeReference, token);
    } else {
      setLoading(false);
    }
  }, [routeReference, token, openBooking]);

  const findBooking = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const found = await guestBookingService.lookupGuestBooking(
        reference.trim(),
        phone.trim(),
      );
      setBooking(found);
      if (!found) {
        setError(
          "We could not find a booking with that reference and mobile number.",
        );
      }
    } catch (err) {
      setError(
        subscriptionService.customerSubscriptionMessage(
          err,
          "We could not look up that booking. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async () => {
    if (!booking) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = token
        ? await guestBookingService.cancelGuestBooking(booking.reference, token)
        : await guestBookingService.cancelGuestBookingByPhone(
            booking.reference,
            phone.trim(),
          );
      setBooking(updated);
      setNotice(
        "Booking cancelled. The court is open for other players again.",
      );
    } catch (err) {
      setError(
        subscriptionService.customerSubscriptionMessage(
          err,
          "We could not cancel this booking. Please contact the facility.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const claimBooking = async () => {
    if (!booking) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await guestBookingService.claimGuestBooking(
        booking.reference,
        token,
      );
      setBooking(updated);
      setNotice(
        "This booking is part of your account now. Find it under My bookings.",
      );
    } catch (err) {
      setError(
        subscriptionService.customerSubscriptionMessage(
          err,
          "We could not link this booking to your account.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const managePath = booking
    ? `/booking/${booking.reference}${token ? `?t=${token}` : ""}`
    : "/booking";
  const canCancel =
    booking &&
    !booking.isClaimed &&
    ["upcoming", "confirmed"].includes(booking.status);
  const showLookup = !booking && !loading;
  const createAccountPath = booking
    ? `/register?${new URLSearchParams({
        fullName: booking.customerName,
        phone: booking.customerPhone,
        next: managePath,
      }).toString()}`
    : "/register";

  return (
    <main className="page-wrap manage-booking-page">
      <div className="page-intro compact">
        <span className="eyebrow">YOUR BOOKING</span>
        <h1>
          Manage your <em>booking.</em>
        </h1>
        <p>
          Open the booking with the link or QR code from your confirmation, or
          find it with your booking reference and mobile number.
        </p>
      </div>

      {loading && <p className="loading-state">Opening your booking…</p>}

      {booking && (
        <section className="manage-booking-card">
          <div className="manage-booking-head">
            <div>
              <span className="eyebrow">BOOKING REFERENCE</span>
              <strong className="manage-booking-reference">
                {booking.reference}
              </strong>
            </div>
            <span className={`status status-${booking.status}`}>
              {booking.status}
            </span>
          </div>
          <div className="details-grid">
            <div>
              <small>Court</small>
              <strong>{booking.courtName}</strong>
              <span>{booking.date}</span>
              <span>
                {formatTimeRange12(booking.time, booking.duration)} ·{" "}
                {booking.duration} hr
              </span>
            </div>
            <div>
              <small>Guest</small>
              <strong>{booking.customerName}</strong>
              <span>{booking.customerPhone}</span>
              <span>
                {booking.isClaimed ? "Linked to an account" : "Guest booking"}
              </span>
            </div>
            <div>
              <small>Payment</small>
              <strong>{formatCurrency(booking.amount)}</strong>
              <span>Pay at court</span>
              <span className={`status status-${booking.paymentStatus}`}>
                {booking.paymentStatus}
              </span>
            </div>
            <div>
              <small>Booked on</small>
              <strong>{String(booking.createdAt || "").slice(0, 10)}</strong>
              <span>Your reference is also shown at the front desk.</span>
            </div>
          </div>

          {notice && <div className="success-message">{notice}</div>}
          {error && <ErrorMessage message={error} />}

          <div className="details-actions">
            {canCancel && (
              <button
                className="button danger"
                type="button"
                disabled={busy}
                onClick={cancelBooking}>
                {busy ? "Cancelling..." : "Cancel booking"}
              </button>
            )}
            {booking.isClaimed && (
              <Link
                className="button outline"
                to={user ? "/my-bookings" : "/login"}>
                {user ? "Open My bookings" : "Sign in to manage"}
              </Link>
            )}
            <Button to="/book-court" variant="outline">
              Book another court
            </Button>
          </div>

          {!booking.isClaimed && (
            <div className="create-account-cta">
              <div>
                <strong>Optional: create an account</strong>
                <p>
                  Keep this booking in your history and book future hours in a
                  few taps with your details already filled in.
                </p>
              </div>
              {user ? (
                <button
                  className="button outline"
                  type="button"
                  disabled={busy || !token}
                  onClick={claimBooking}
                  title={
                    token
                      ? ""
                      : "Open this page with your secure link to link the booking."
                  }>
                  Link this booking to my account
                </button>
              ) : (
                <Link className="text-link" to={createAccountPath}>
                  Create an account
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {showLookup && (
        <section className="manage-booking-lookup">
          <div>
            <span className="eyebrow">FIND MY BOOKING</span>
            <h2>Booking reference + mobile number</h2>
            <p>
              No QR code handy? Enter the reference from your confirmation and
              the mobile number you booked with.
            </p>
          </div>
          <form className="form-card" onSubmit={findBooking}>
            <label>
              Booking reference
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="RB-260923-001"
                required
              />
            </label>
            <label>
              Mobile number
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="0917 555 0188"
                inputMode="tel"
                required
              />
            </label>
            {error && <ErrorMessage message={error} />}
            <button className="button" type="submit" disabled={busy}>
              {busy ? "Searching..." : "Find my booking"}{" "}
              <span aria-hidden="true">-&gt;</span>
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => navigate("/")}>
              Back to the landing page
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
