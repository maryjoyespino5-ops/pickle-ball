import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookingSummary } from "../../components/booking/BookingSummary";
import { TimeSlot } from "../../components/booking/TimeSlot";
import { Modal } from "../../components/common/Modal";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { courtService } from "../../services/courtService";
import { bookingService } from "../../services/bookingService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12, todayISO } from "../../utils/dateUtils";
import { HOURLY_RATE } from "../../lib/constants";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { useRealtimeBookings } from "../../hooks/useRealtimeBookings";

export function BookCourt() {
  const navigate = useNavigate();
  useScrollReveal();
  const [date, setDate] = useState(todayISO);
  const [courts, setCourts] = useState([]);
  const [selected, setSelected] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  useEffect(() => {
    courtService.getAvailability(date).then(setCourts);
    setSelected({});
  }, [date]);

  // Live availability: if another customer books (or an admin reschedules)
  // while this page is open, the slot grid refreshes from the bookings table.
  useRealtimeBookings(
    () => courtService.getAvailability(date).then(setCourts),
    Boolean(date),
  );

  // Drop the selection if the chosen slot is no longer available.
  useEffect(() => {
    if (!selected.courtId || !selected.time) return;
    const court = courts.find((item) => item.id === selected.courtId);
    const slot = court?.slots?.find((item) => item.time === selected.time);
    if (slot && !slot.available) setSelected({});
  }, [courts, selected]);

  const selectedCourt = courts.find((court) => court.id === selected.courtId);
  const booking =
    selectedCourt && selected.time
      ? {
          courtId: selectedCourt.id,
          courtName: selectedCourt.name,
          date,
          time: selected.time,
          amount: selectedCourt.price || HOURLY_RATE,
        }
      : { date };

  const handleConfirm = async () => {
    if (!selectedCourt || !selected.time) return;
    setCreating(true);
    setConfirmError("");
    try {
      await bookingService.createBooking({
        courtId: selectedCourt.id,
        date,
        time: selected.time,
      });
      navigate("/my-bookings", { state: { justBooked: true } });
    } catch (err) {
      setConfirmError(err.message || "Could not confirm booking. Try again.");
      setCreating(false);
    }
  };

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
              min={todayISO()}
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
                      onClick={
                        slot.available
                          ? (event) => {
                              event.stopPropagation();
                              setSelected({ courtId: court.id, time: slot.time });
                            }
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <BookingSummary
          booking={booking}
          onContinue={() => setConfirming(true)}
        />
      </div>

      {confirming && selectedCourt && selected.time && (
        <Modal title="Confirm your booking" onClose={() => setConfirming(false)}>
          <div className="form-card modal-form">
            <div className="summary-row">
              <span>Court</span>
              <strong>{selectedCourt.name}</strong>
            </div>
            <div className="summary-row">
              <span>Date</span>
              <strong>{date}</strong>
            </div>
            <div className="summary-row">
              <span>Time</span>
              <strong>{formatTimeRange12(selected.time)}</strong>
            </div>
            <div className="summary-row">
              <span>Duration</span>
              <strong>1 hour</strong>
            </div>
            <div className="summary-total">
              <span>Total</span>
              <strong>{formatCurrency(selectedCourt.price || HOURLY_RATE)}</strong>
            </div>
            {confirmError && <ErrorMessage message={confirmError} />}
            <button
              className="button full-width"
              disabled={creating}
              onClick={handleConfirm}>
              {creating ? "Confirming..." : "Confirm booking"}{" "}
              <span aria-hidden="true">-&gt;</span>
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
