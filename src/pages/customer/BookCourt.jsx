import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookingSummary } from "../../components/booking/BookingSummary";
import { TimeSlot } from "../../components/booking/TimeSlot";
import { courtService } from "../../services/courtService";
import { HOURLY_RATE } from "../../lib/constants";
export function BookCourt() {
  const navigate = useNavigate();
  const [date, setDate] = useState("2026-09-18");
  const [courts, setCourts] = useState([]);
  const [selected, setSelected] = useState({});
  useEffect(() => {
    courtService.getAvailability(date).then(setCourts);
    setSelected({});
  }, [date]);
  const selectedCourt = courts.find((court) => court.id === selected.courtId);
  const booking =
    selectedCourt && selected.time
      ? {
          courtId: selectedCourt.id,
          courtName: selectedCourt.name,
          date,
          time: selected.time,
          amount: HOURLY_RATE,
        }
      : { date };
  return (
    <main className="book-page">
      <div className="page-intro compact">
        <span className="eyebrow">RESERVE YOUR HOUR</span>
        <h1>
          Book a <em>court.</em>
        </h1>
        <p>
          Choose your date, then pick an open hour. You are one step closer to
          the game.
        </p>
      </div>
      <div className="book-layout">
        <section className="booking-picker">
          <label className="date-field">
            Choose a date
            <input
              type="date"
              min="2026-09-18"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <div className="booking-courts">
            {courts.map((court) => (
              <div
                className={`court-option ${selected.courtId === court.id ? "selected" : ""}`}
                key={court.id}
                onClick={() => setSelected({ courtId: court.id })}>
                <div className="court-option-header">
                  <strong>{court.name}</strong>
                  <span>
                    {selected.courtId === court.id
                      ? "Selected"
                      : "Select court"}
                  </span>
                </div>
                <div className="slot-grid">
                  {court.slots.map((slot) => (
                    <TimeSlot
                      key={slot.time}
                      {...slot}
                      selected={
                        selected.courtId === court.id &&
                        selected.time === slot.time
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected({ courtId: court.id, time: slot.time });
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <BookingSummary
          booking={booking}
          onContinue={() =>
            navigate("/my-bookings", { state: { justBooked: true, booking } })
          }
        />
      </div>
    </main>
  );
}
