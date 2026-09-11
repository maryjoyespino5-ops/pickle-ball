import { useEffect, useState } from "react";
import { TimeSlot } from "../../components/booking/TimeSlot";
import { courtService } from "../../services/courtService";
import { formatCurrency } from "../../utils/currencyUtils";
import { todayISO } from "../../utils/dateUtils";
import { HOURLY_RATE } from "../../lib/constants";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { useRealtimeBookings } from "../../hooks/useRealtimeBookings";

export function Availability() {
  useScrollReveal();
  const [date, setDate] = useState(todayISO);
  const [courts, setCourts] = useState([]);
  const [error, setError] = useState("");
  const load = (target = date) => {
    setError("");
    courtService
      .getAvailability(target)
      .then(setCourts)
      .catch((err) => setError(err.message));
  };
  useEffect(() => {
    load(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  // Live board: any booking made anywhere updates open slots instantly.
  useRealtimeBookings(() => load(date), Boolean(date));
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
        <div className="empty-panel">
          Availability is temporarily unavailable. Please try again later.
          <button
            className="button outline"
            type="button"
            onClick={() => load(date)}>
            Try again
          </button>
        </div>
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
