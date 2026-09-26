import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { CANCELLABLE_STATUSES } from "../../lib/constants";
import { PaymentStatus } from "../booking/PaymentStatus";
export function BookingTable({
  bookings = [],
  onCancel,
  onPay,
  payingId = "",
}) {
  return (
    <div className="table-wrap">
      <table className="booking-table">
        <thead>
          <tr>
            <th>Booking</th>
            <th>Court</th>
            <th>Date & time</th>
            <th>Amount</th>
            <th>Booking status</th>
            <th>Payment status</th>
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
              <td data-label="Booking status">
                <span className={`status status-${booking.status}`}>
                  {booking.status}
                </span>
              </td>
              {/* Payment is deliberately its OWN column, separate from the
                  booking status above: paying settles the MONEY, not the game.
                  A GCash payment flips this to 'paid' while the booking stays
                  'pending' until the slot is played. The badge underneath
                  names how it was paid — "Paid · GCash" when the player paid
                  online, "Paid · Pay at Court" when an admin took cash. */}
              <td data-label="Payment status">
                <PaymentStatus
                  paymentStatus={booking.paymentStatus}
                  paymentMethod={booking.paymentMethod}
                />
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
