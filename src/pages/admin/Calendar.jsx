import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarView } from "../../components/dashboard/CalendarView";
import { Modal } from "../../components/common/Modal";
import { BookingDetails } from "../../components/booking/BookingDetails";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { bookingService } from "../../services/bookingService";
import { courtService } from "../../services/courtService";
import { facilityService } from "../../services/facilityService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { useRealtimeBookings } from "../../hooks/useRealtimeBookings";
export function Calendar() {
  const [searchParams] = useSearchParams();
  const requestedCourt = searchParams.get("court") || "";
  const todayIso = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);
  const [date, setDate] = useState(todayIso);
  const [courts, setCourts] = useState([]);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({
    customer: "",
    email: "",
    phone: "",
    duration: 1,
    paymentMethod: "Pay at Court",
  });
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [facility, setFacility] = useState(null);
  const load = async () => {
    setLoadError("");
    try {
      const [nextCourts, nextBookings, nextFacility] = await Promise.all([
        courtService.getAvailability(date),
        bookingService.getAllBookings({ date }),
        facilityService.getPublicInfo().catch(() => null),
      ]);
      setCourts(requestedCourt ? nextCourts.filter((court) => court.id === requestedCourt) : nextCourts);
      setBookings(requestedCourt ? nextBookings.filter((booking) => booking.courtId === requestedCourt) : nextBookings);
      if (nextFacility) {
        setFacility(nextFacility);
        setForm((current) => ({
          ...current,
          duration: nextFacility.defaultDuration || current.duration || 1,
        }));
      }
    } catch (loadErr) {
      setLoadError(loadErr.message || "Could not load the calendar. Try again.");
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  // Realtime: a customer booking elsewhere instantly flips this slot to BOOKED.
  useRealtimeBookings(load, Boolean(date));
  const maxDuration = Number(facility?.maxDuration) || 2;
  const durationOptions = Array.from(
    { length: Math.max(1, Math.min(4, maxDuration)) },
    (_, index) => index + 1,
  );
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await bookingService.createAdminBooking({
        ...form,
        courtId: slot.court.id,
        date,
        time: slot.time,
      });
    } catch (submissionError) {
      setError(submissionError.message);
      return;
    }
    await load();
    setSlot(null);
    setForm({
      customer: "",
      email: "",
      phone: "",
      duration: 1,
      paymentMethod: "Pay at Court",
    });
  };
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">AVAILABILITY PLANNER</span>
          <h2>Calendar</h2>
          <p>
            Manage both courts at a glance. Click any slot to inspect or create
            a booking.
          </p>
        </div>
        <input
          type="date"
          value={date}
          min={todayIso}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>
      <div className="calendar-legend">
        <span>
          <i className="dot open" /> Available
        </span>
        <span>
          <i className="dot taken" /> Booked
        </span>
        <span>Click an open slot to create a manual booking</span>
      </div>
      {loadError && (
        <div className="admin-load-row">
          <ErrorMessage message={loadError} />
          <button className="button outline" type="button" onClick={load}>
            Try again
          </button>
        </div>
      )}
      <CalendarView
        courts={courts}
        facility={facility}
        onSlotClick={(court, time, available) =>
          setSlot({
            court,
            time,
            available,
            booking: bookings.find(
              (booking) =>
                booking.courtId === court.id && booking.time === time,
            ),
          })
        }
      />
      {slot && (
        <Modal
          title={slot.available ? "Create manual booking" : "View booking"}
          onClose={() => setSlot(null)}>
          {slot.available ? (
            <form className="form-card modal-form" onSubmit={submit}>
              <p>
                Reserve <strong>{slot.court.name}</strong> at{" "}
                <strong>{formatTime12(slot.time)}</strong> on {date}.
              </p>
              <label>
                Customer name
                <input
                  required
                  value={form.customer}
                  onChange={(event) =>
                    setForm({ ...form, customer: event.target.value })
                  }
                />
              </label>
              <label>
                Email
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </label>
              <label>
                Phone
                <input
                  required
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
              <label>
                Duration
                <select
                  value={form.duration}
                  onChange={(event) =>
                    setForm({ ...form, duration: Number(event.target.value) })
                  }>
                  {durationOptions.map((hours) => (
                    <option key={hours} value={hours}>
                      {hours} hour{hours > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Payment method
                <select
                  value={form.paymentMethod}
                  onChange={(event) =>
                    setForm({ ...form, paymentMethod: event.target.value })
                  }>
                  <option>Pay at Court</option>
                  <option>GCash</option>
                </select>
              </label>
              <div className="booking-amount-preview">
                {form.duration} hour{form.duration > 1 ? "s" : ""} ×{" "}
                {formatCurrency(slot.court.price || facility?.minPrice || 300)} ={" "}
                <strong>
                  {formatCurrency(
                    form.duration * (slot.court.price || facility?.minPrice || 300),
                  )}
                </strong>
              </div>
              {error && <ErrorMessage message={error} />}
              <button className="button" type="submit">
                Create booking
              </button>
            </form>
          ) : slot.booking ? (
            <BookingDetails
              booking={slot.booking}
              onAction={() => setSlot(null)}
              onReschedule={() => setSlot(null)}
            />
          ) : (
            <div className="empty-panel">
              This time is already booked. No booking details are available.
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
