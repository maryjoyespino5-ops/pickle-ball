import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { CANCELLABLE_STATUSES } from "../../lib/constants";
export function BookingTable({ bookings = [], onCancel, onPay, payingId = "" }) {
  return (
    <div className="table-wrap">
      <table className="booking-table">
        <thead>
          <tr>
            <th>Booking</th>
            <th>Court</th>
            <th>Date & time</th>
            <th>Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bookings.map((booking) => (
            <tr key={booking.id}>
              <td data-label="Booking">
                <strong>{booking.id}</strong>
              </td>
              <td data-label="Court">{booking.courtName}</td>
              <td data-label="Date & time">
                {booking.date}
                <br />
                <small>
                  {formatTime12(booking.time)} · {booking.duration} hour
                </small>
              </td>
              <td data-label="Amount">{formatCurrency(booking.amount)}</td>
              <td data-label="Status">
                <span className={`status status-${booking.status}`}>
                  {booking.status}
                </span>
                <br />
                <small className="payment-status">
                  {booking.paymentStatus}
                </small>
                {/* A GCash-paid booking is PAID + CONFIRMED; surface both
                    side by side so the player sees the settled state. */}
                {booking.isPaid && booking.isConfirmed && (
                  <>
                    <br />
                    <small className="payment-status paid-confirmed-badge">
                      Paid · Confirmed
                    </small>
                  </>
                )}
              </td>
              <td className="table-action-cell">
                {CANCELLABLE_STATUSES.includes(booking.status) &&
                  booking.paymentStatus !== "paid" &&
                  onPay && (
                    <button
                      className="text-button"
                      disabled={payingId === booking.id}
                      onClick={() => onPay(booking.id)}>
                      {payingId === booking.id
                        ? "Opening GCash..."
                        : "Pay with GCash"}
                    </button>
                  )}
                {CANCELLABLE_STATUSES.includes(booking.status) && (
                  <button
                    className="text-button"
                    onClick={() => onCancel(booking.id)}>
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
