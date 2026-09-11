import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookingSummary } from "../../components/booking/BookingSummary";
import { TimeSlot } from "../../components/booking/TimeSlot";
import { Modal } from "../../components/common/Modal";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { courtService } from "../../services/courtService";
import { bookingService } from "../../services/bookingService";
import { facilityService } from "../../services/facilityService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12, todayISO } from "../../utils/dateUtils";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { useRealtimeBookings } from "../../hooks/useRealtimeBookings";

export function BookCourt() {
  const navigate = useNavigate();
  useScrollReveal();
  const [date, setDate] = useState(todayISO);
  const [courts, setCourts] = useState([]);
  const [selected, setSelected] = useState({});
  const [duration, setDuration] = useState(1);
  const [maxDuration, setMaxDuration] = useState(2);
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = async (targetDate) => {
    setLoadError("");
    try {
      const [nextCourts, facility] = await Promise.all([
        courtService.getAvailability(targetDate),
        facilityService.getPublicInfo().catch(() => null),
      ]);
      setCourts(nextCourts);
      if (facility) {
        setMaxDuration(Number(facility.maxDuration) || 2);
        setDuration((current) => {
          const fallback = Number(facility.defaultDuration) || 1;
          return current && current <= (Number(facility.maxDuration) || 2)
            ? current
            : fallback;
        });
      }
    } catch (err) {
      setLoadError(err.message || "Could not load availability. Try again.");
    }
  };

  useEffect(() => {
    load(date);
    setSelected({});
  }, [date]);

  // Live availability: if another customer books (or an admin reschedules)
  // while this page is open, the slot grid refreshes from the bookings table.
  useRealtimeBookings(() => load(date), Boolean(date));

  // Drop the selection if the chosen slot is no longer available.
  useEffect(() => {
    if (!selected.courtId || !selected.time) return;
    const court = courts.find((item) => item.id === selected.courtId);
    const slot = court?.slots?.find((item) => item.time === selected.time);
    if (slot && !slot.available) setSelected({});
  }, [courts, selected]);

  const selectedCourt = courts.find((court) => court.id === selected.courtId);
  const durationOptions = Array.from(
    { length: Math.max(1, Math.min(4, maxDuration)) },
    (_, index) => index + 1,
  );
  const hourlyRate = selectedCourt?.price || 300;
  const booking =
    selectedCourt && selected.time
      ? {
          courtId: selectedCourt.id,
          courtName: selectedCourt.name,
          date,
          time: selected.time,
          duration,
          amount: hourlyRate * duration,
        }
      : { date, duration };

  const handleConfirm = async () => {
    if (!selectedCourt || !selected.time) return;
    setCreating(true);
    setConfirmError("");
    try {
      await bookingService.createBooking({
        courtId: selectedCourt.id,
        date,
        time: selected.time,
        duration,
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
      {loadError && (
        <div className="admin-load-row">
          <ErrorMessage message={loadError} />
          <button
            className="button outline"
            type="button"
            onClick={() => load(date)}>
            Try again
          </button>
        </div>
      )}
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
          <label className="duration-field">
            Duration
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}>
              {durationOptions.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} hour{hours > 1 ? "s" : ""} ·{" "}
                  {formatCurrency(hourlyRate * hours)}
                </option>
              ))}
            </select>
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
              <strong>{formatTimeRange12(selected.time, duration)}</strong>
            </div>
            <div className="summary-row">
              <span>Duration</span>
              <strong>
                {duration} hour{duration > 1 ? "s" : ""}
              </strong>
            </div>
            <div className="summary-total">
              <span>Total</span>
              <strong>{formatCurrency(hourlyRate * duration)}</strong>
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
