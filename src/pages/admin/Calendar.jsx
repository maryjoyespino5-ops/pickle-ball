import { useEffect, useState } from "react";
import { CalendarView } from "../../components/dashboard/CalendarView";
import { Modal } from "../../components/common/Modal";
import { BookingDetails } from "../../components/booking/BookingDetails";
import { bookingService } from "../../services/bookingService";
import { courtService } from "../../services/courtService";
import { HOURLY_RATE } from "../../lib/constants";
export function Calendar() {
  const [date, setDate] = useState("2026-09-18");
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
  useEffect(() => {
    Promise.all([
      courtService.getAvailability(date),
      bookingService.getAllBookings({ date }),
    ]).then(([nextCourts, nextBookings]) => {
      setCourts(nextCourts);
      setBookings(nextBookings);
    });
  }, [date]);
  const submit = async (event) => {
    event.preventDefault();
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
    const [nextCourts, nextBookings] = await Promise.all([
      courtService.getAvailability(date),
      bookingService.getAllBookings({ date }),
    ]);
    setCourts(nextCourts);
    setBookings(nextBookings);
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
          min="2026-09-18"
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
      <CalendarView
        courts={courts}
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
                <strong>{slot.time}</strong> on {date}.
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
                  <option value="1">1 hour</option>
                  <option value="2">2 hours</option>
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
                {form.duration} hour × ₱{HOURLY_RATE} ={" "}
                <strong>₱{form.duration * HOURLY_RATE}</strong>
              </div>
              {error && <p className="error-message">{error}</p>}
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
