import { useEffect, useState } from "react";
import { TimeSlot } from "../../components/booking/TimeSlot";
import { courtService } from "../../services/courtService";
import { formatCurrency } from "../../utils/currencyUtils";
import { todayISO } from "../../utils/dateUtils";
import { HOURLY_RATE } from "../../lib/constants";

export function Availability() {
  const [date, setDate] = useState(todayISO);
  const [courts, setCourts] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    courtService
      .getAvailability(date)
      .then(setCourts)
      .catch((err) => setError(err.message));
  }, [date]);
  return (
    <main className="page-wrap availability-page">
      <div className="page-intro compact">
        <span className="eyebrow">PLAN YOUR GAME</span>
        <h1>
          Check <em>availability.</em>
        </h1>
        <p>Choose a date to see open times across both courts.</p>
      </div>
      <div className="availability-toolbar">
        <label>
          Date
          <input
            type="date"
            value={date}
            min={todayISO()}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <span>
          <i className="dot open" /> Open <i className="dot taken" /> Booked
        </span>
      </div>
      {error ? (
        <p className="empty-panel">
          Availability is temporarily unavailable. Please try again later.
        </p>
      ) : (
        <div className="availability-board">
          {courts.map((court) => (
            <section className="court-row" key={court.id}>
              <div className="court-row-name">
                <strong>{court.name}</strong>
                <small>{formatCurrency(court.price || HOURLY_RATE)} / hour</small>
              </div>
              <div className="slot-grid">
                {court.slots.map((slot) => (
                  <TimeSlot key={slot.time} {...slot} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
