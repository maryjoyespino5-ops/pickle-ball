import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
export function BookingTable({ bookings = [], onCancel }) {
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
              </td>
              <td className="table-action-cell">
                {["upcoming", "confirmed"].includes(booking.status) && (
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
