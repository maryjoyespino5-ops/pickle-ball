import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12 } from "../../utils/dateUtils";
import {
  BOOKING_STATUSES,
  CANCELLABLE_STATUSES,
  PAYMENT_STATUSES,
} from "../../lib/constants";
export function BookingDetails({
  booking,
  onAction,
  onReschedule,
  readOnly = false,
}) {
  return (
    <div className="booking-details">
      <div className="details-id">
        <span className="eyebrow">BOOKING DETAILS</span>
        <strong>{booking.id}</strong>
      </div>
      <div className="details-grid">
        <div>
          <small>Customer</small>
          <strong>{booking.customer}</strong>
          <span>{booking.email}</span>
          <span>{booking.phone}</span>
          <span
            className={`booking-source ${booking.isGuest ? "guest" : "account"}`}>
            {booking.isGuest
              ? "Guest booking (no account)"
              : "Registered account"}
          </span>
        </div>
        <div>
          <small>Court</small>
          <strong>{booking.courtName}</strong>
          <span>{booking.date}</span>
          <span>{formatTimeRange12(booking.time, booking.duration)}</span>
        </div>
        <div>
          <small>Payment</small>
          <strong>{formatCurrency(booking.amount)}</strong>
          <span>{booking.paymentMethod}</span>
          <span className={`status status-${booking.paymentStatus}`}>
            {booking.paymentStatus}
          </span>
        </div>
        <div>
          <small>Booking status</small>
          <strong className={`status status-${booking.status}`}>
            {booking.status}
          </strong>
          <span>Created {booking.createdAt}</span>
        </div>
      </div>
      {/* Confirm and Complete were removed with the simplified lifecycle
          (migration 0024): a verified GCash payment confirms a booking and
          complete_past_bookings() completes it once the slot ends. What is left
          for a human is recording a Pay-at-Court payment, rescheduling, and
          cancelling. */}
      <div className="details-actions">
        {!readOnly && booking.paymentStatus === PAYMENT_STATUSES.PENDING && (
          <button className="button outline" onClick={() => onAction("paid")}>
            Mark paid
          </button>
        )}
        {!readOnly && booking.status !== BOOKING_STATUSES.CANCELLED && (
          <button className="text-button" onClick={() => onAction("cancelled")}>
            Cancel booking
          </button>
        )}
        {!readOnly && CANCELLABLE_STATUSES.includes(booking.status) && (
          <button className="button outline" onClick={onReschedule}>
            Reschedule
          </button>
        )}
      </div>
    </div>
  );
}
