import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { BOOKING_STATUSES, CANCELLABLE_STATUSES } from "../../lib/constants";
import { PaymentStatus } from "../booking/PaymentStatus";
export function AdminBookingTable({
  bookings = [],
  onView,
  onCancel,
  onReschedule,
  busy = false,
  readOnly = false,
}) {
  return (
    <div className="table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Booking ID</th>
            <th>Customer</th>
            <th>Court</th>
            <th>Date / time</th>
            <th>Duration</th>
            <th>Amount</th>
            <th>Booking status</th>
            <th>Payment status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bookings.map((booking) => (
            <tr key={booking.id}>
              <td data-label="Booking ID">
                <strong>{booking.id}</strong>
              </td>
              <td data-label="Customer">
                <span className="customer-cell">
                  <span className="customer-name">
                    {booking.customer}
                    <span
                      className={`booking-source ${booking.isGuest ? "guest" : "account"}`}>
                      {booking.isGuest ? "Guest" : "Account"}
                    </span>
                  </span>
                  <small>{booking.email || booking.phone || "No contact on file"}</small>
                </span>
              </td>
              <td data-label="Court">{booking.courtName}</td>
              <td data-label="Date / time">
                {booking.date}
                <small>{formatTime12(booking.time)}</small>
              </td>
              <td data-label="Duration">{booking.duration} hr</td>
              <td data-label="Amount">{formatCurrency(booking.amount)}</td>
              <td data-label="Booking status">
                <span className={`status status-${booking.status}`}>
                  {booking.status}
                </span>
              </td>
              {/* Payment status is its own column, read from the same
                  payments row the player sees, so admin and player can never
                  disagree about whether the money settled. The badge names HOW
                  it was paid, which is what the owner needs to reconcile the
                  day's takings: "Paid · GCash" (player paid online) versus
                  "Paid · Pay at Court" (cash collected at the desk). */}
              <td data-label="Payment status">
                <PaymentStatus
                  paymentStatus={booking.paymentStatus}
                  paymentMethod={booking.paymentMethod}
                />
              </td>
              <td className="table-action-cell">
                <div className="row-actions">
                  <button disabled={busy} onClick={() => onView(booking)}>
                    View
                  </button>
                  {!readOnly && CANCELLABLE_STATUSES.includes(booking.status) && (
                    <button
                      disabled={busy}
                      onClick={() => onReschedule(booking)}>
                      Reschedule
                    </button>
                  )}
                  {!readOnly &&
                    booking.status !== BOOKING_STATUSES.CANCELLED && (
                      <button disabled={busy} onClick={() => onCancel(booking)}>
                        Cancel
                      </button>
                    )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
