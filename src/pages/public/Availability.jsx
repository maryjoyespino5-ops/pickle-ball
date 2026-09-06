import { useEffect, useState } from "react";
import { TimeSlot } from "../../components/booking/TimeSlot";
import { courtService } from "../../services/courtService";
export function Availability() {
  const [date, setDate] = useState("2026-09-18");
  const [courts, setCourts] = useState([]);
  useEffect(() => {
    courtService.getAvailability(date).then(setCourts);
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
            min="2026-09-18"
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <span>
          <i className="dot open" /> Open <i className="dot taken" /> Booked
        </span>
      </div>
      <div className="availability-board">
        {courts.map((court) => (
          <section className="court-row" key={court.id}>
            <div className="court-row-name">
              <strong>{court.name}</strong>
              <small>₱300 / hour</small>
            </div>
            <div className="slot-grid">
              {court.slots.map((slot) => (
                <TimeSlot key={slot.time} {...slot} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
