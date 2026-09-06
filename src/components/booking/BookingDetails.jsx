import { formatCurrency } from "../../utils/currencyUtils";
export function BookingDetails({ booking, onAction, onReschedule }) {
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
        </div>
        <div>
          <small>Court</small>
          <strong>{booking.courtName}</strong>
          <span>{booking.date}</span>
          <span>
            {booking.time} -{" "}
            {String(
              Number(booking.time.slice(0, 2)) + booking.duration,
            ).padStart(2, "0")}
            :00
          </span>
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
      <div className="details-actions">
        {booking.status === "pending" && (
          <button className="button" onClick={() => onAction("confirmed")}>
            Confirm booking
          </button>
        )}
        {booking.paymentStatus === "pending" && (
          <button className="button outline" onClick={() => onAction("paid")}>
            Mark paid
          </button>
        )}
        {booking.status === "confirmed" && (
          <button
            className="button outline"
            onClick={() => onAction("completed")}>
            Mark completed
          </button>
        )}
        <button className="text-button" onClick={() => onAction("cancelled")}>
          Cancel booking
        </button>
        {["pending", "confirmed"].includes(booking.status) && (
          <button className="button outline" onClick={onReschedule}>
            Reschedule
          </button>
        )}
      </div>
    </div>
  );
}
