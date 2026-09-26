import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { BOOKING_STATUSES, CANCELLABLE_STATUSES } from "../../lib/constants";
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
            <th>Status</th>
            <th>Payment</th>
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
              <td data-label="Status">
                <span className={`status status-${booking.status}`}>
                  {booking.status}
                </span>
              </td>
              <td data-label="Payment">
                <span className={`status status-${booking.paymentStatus}`}>
                  {booking.paymentStatus}
                </span>
                {/* A GCash-paid booking is settled end to end: show the method
                    alongside the PAID + CONFIRMED state, for guest bookings too
                    (their payment row carries the PayMongo reference). */}
                {booking.isPaid && booking.isConfirmed && (
                  <>
                    <br />
                    <small className="payment-status paid-confirmed-badge">
                      Paid · Confirmed
                      {booking.paymentMethod ? ` · ${booking.paymentMethod}` : ""}
                    </small>
                  </>
                )}
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
