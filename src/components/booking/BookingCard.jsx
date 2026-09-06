import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12 } from "../../utils/dateUtils";
export function BookingCard({ booking }) {
  return (
    <article className="booking-card">
      <div className="booking-card-top">
        <span className="booking-date">
          {new Date(`${booking.date}T12:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </span>
        <span className={`status status-${booking.status}`}>
          {booking.status}
        </span>
      </div>
      <div className="booking-card-main">
        <div>
          <span className="eyebrow">{booking.id}</span>
          <h3>{booking.courtName}</h3>
          <p>
            {formatTimeRange12(booking.time, booking.duration || 1)} ·{" "}
            {booking.duration} hour
          </p>
        </div>
        <strong>{formatCurrency(booking.amount)}</strong>
      </div>
    </article>
  );
}
