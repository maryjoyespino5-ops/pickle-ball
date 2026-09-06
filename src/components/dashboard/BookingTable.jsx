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
              <td>
                <strong>{booking.id}</strong>
              </td>
              <td>{booking.courtName}</td>
              <td>
                {booking.date}
                <br />
                <small>
                  {formatTime12(booking.time)} · {booking.duration} hour
                </small>
              </td>
              <td>{formatCurrency(booking.amount)}</td>
              <td>
                <span className={`status status-${booking.status}`}>
                  {booking.status}
                </span>
                <br />
                <small className="payment-status">
                  {booking.paymentStatus}
                </small>
              </td>
              <td>
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
