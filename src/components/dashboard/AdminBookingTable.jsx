import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
export function AdminBookingTable({
  bookings = [],
  onView,
  onCancel,
  onConfirm,
  onComplete,
  onReschedule,
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
                {booking.customer}
                <small>{booking.email}</small>
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
              </td>
              <td className="table-action-cell">
                <div className="row-actions">
                  <button onClick={() => onView(booking)}>View</button>
                  {booking.status === "pending" && (
                    <button onClick={() => onConfirm(booking)}>Confirm</button>
                  )}
                  {booking.status === "confirmed" && (
                    <button onClick={() => onComplete(booking)}>
                      Complete
                    </button>
                  )}
                  {["pending", "confirmed"].includes(booking.status) && (
                    <button onClick={() => onReschedule(booking)}>
                      Reschedule
                    </button>
                  )}
                  {booking.status !== "cancelled" && (
                    <button onClick={() => onCancel(booking)}>Cancel</button>
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
