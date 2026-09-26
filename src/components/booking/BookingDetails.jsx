import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12 } from "../../utils/dateUtils";
import { PaymentStatus } from "./PaymentStatus";
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
          {/* The badge names how the money was collected, which is the whole
              question when an owner is reconciling: "Paid · GCash" means the
              player paid online, "Paid · Pay at Court" means cash at the desk. */}
          <PaymentStatus
            paymentStatus={booking.paymentStatus}
            paymentMethod={booking.paymentMethod}
          />
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
          (migration 0024): a verified GCash payment settles the MONEY and
          complete_past_bookings() completes the booking once the slot ends.
          What is left for a human is recording a Pay-at-Court payment,
          rescheduling, and cancelling. */}
      <div className="details-actions">
        {/* "Mark paid" records CASH handed over at the desk. It is deliberately
            hidden for GCash bookings: that money went through PayMongo, and
            letting an admin hand-flip it would allow a court to be marked paid
            that was never paid for. A GCash booking settles itself via the
            webhook (with paymongo-verify as the self-healing fallback). */}
        {!readOnly &&
          booking.paymentStatus === PAYMENT_STATUSES.PENDING &&
          !/gcash/i.test(String(booking.paymentMethod || "")) && (
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
