import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12 } from "../../utils/dateUtils";
export function BookingSummary({ booking, onContinue }) {
  return (
    <section className="booking-summary">
      <div className="summary-heading">
        <span className="eyebrow">YOUR RESERVATION</span>
        <h2>Booking summary</h2>
      </div>
      <div className="summary-row">
        <span>Court</span>
        <strong>{booking?.courtName || "Choose a court"}</strong>
      </div>
      <div className="summary-row">
        <span>Date</span>
        <strong>{booking?.date || "Choose a date"}</strong>
      </div>
      <div className="summary-row">
        <span>Time</span>
        <strong>
          {booking?.time
            ? formatTimeRange12(booking.time, booking.duration || 1)
            : "Choose a time"}
        </strong>
      </div>
      <div className="summary-total">
        <span>Total</span>
        <strong>{formatCurrency(booking?.amount || 300)}</strong>
      </div>
      <button
        className="button full-width"
        disabled={!booking?.courtId || !booking?.time}
        onClick={onContinue}>
        Continue to confirmation <span aria-hidden="true">-&gt;</span>
      </button>
    </section>
  );
}
