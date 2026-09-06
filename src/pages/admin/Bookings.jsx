import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminBookingTable } from "../../components/dashboard/AdminBookingTable";
import { BookingDetails } from "../../components/booking/BookingDetails";
import { Modal } from "../../components/common/Modal";
import { bookingService } from "../../services/bookingService";
export function Bookings() {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    date: "",
    court: "all",
    status: "all",
    paymentStatus: "all",
  });
  const [bookings, setBookings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [reschedule, setReschedule] = useState({
    date: "2026-09-18",
    courtId: "court-1",
    time: "17:00",
  });
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    bookingService.getAllBookings(filters).then(setBookings);
  }, [filters]);
  const setFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const update = async (action) => {
    if (!selected) return;
    if (action === "cancelled") {
      setCancelTarget(selected);
      return;
    }
    const next = await bookingService.updateBooking(
      selected.id,
      action === "paid" ? { paymentStatus: "paid" } : { status: action },
    );
    setBookings((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );
    setSelected(next);
    setFeedback(`Booking ${next.id} updated.`);
  };
  const beginReschedule = (booking) => {
    setSelected(null);
    setRescheduleTarget(booking);
    setReschedule({
      date: booking.date,
      courtId: booking.courtId,
      time: booking.time,
    });
  };
  const saveReschedule = async (event) => {
    event.preventDefault();
    try {
      const next = await bookingService.rescheduleBooking(
        rescheduleTarget.id,
        reschedule,
      );
      setBookings((items) =>
        items.map((item) => (item.id === next.id ? next : item)),
      );
      setRescheduleTarget(null);
      setFeedback(`Booking ${next.id} rescheduled.`);
    } catch (error) {
      setFeedback(error.message);
    }
  };
  const action = (type) => (booking) =>
    type === "cancel"
      ? setCancelTarget(booking)
      : type === "reschedule"
        ? beginReschedule(booking)
        : updateSelected(booking, type);
  const updateSelected = async (booking, type) => {
    const next = await bookingService.updateBooking(booking.id, {
      status: type,
    });
    setBookings((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );
    setFeedback(`Booking ${next.id} marked ${type}.`);
  };
  const cancel = async () => {
    if (!cancelTarget) return;
    const next = await bookingService.updateBooking(cancelTarget.id, {
      status: "cancelled",
      paymentStatus:
        cancelTarget.paymentStatus === "paid"
          ? "refunded"
          : cancelTarget.paymentStatus,
    });
    setBookings((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );
    setCancelTarget(null);
    setFeedback(`Booking ${next.id} cancelled.`);
  };
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">BOOKING MANAGEMENT</span>
          <h2>Bookings</h2>
          <p>Search, review, and manage every court reservation.</p>
        </div>
        <span className="result-count">{bookings.length} results</span>
      </div>
      {feedback && (
        <div className="success-message admin-feedback">
          {feedback}
          <button onClick={() => setFeedback("")}>×</button>
        </div>
      )}
      <div className="admin-filters">
        <input
          placeholder="Search ID or customer"
          value={filters.search}
          onChange={(event) => setFilter("search", event.target.value)}
        />
        <input
          type="date"
          value={filters.date}
          onChange={(event) => setFilter("date", event.target.value)}
        />
        <select
          value={filters.court}
          onChange={(event) => setFilter("court", event.target.value)}>
          <option value="all">All courts</option>
          <option value="court-1">Court 1</option>
          <option value="court-2">Court 2</option>
        </select>
        <select
          value={filters.status}
          onChange={(event) => setFilter("status", event.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={filters.paymentStatus}
          onChange={(event) => setFilter("paymentStatus", event.target.value)}>
          <option value="all">All payments</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>
      {bookings.length ? (
        <AdminBookingTable
          bookings={bookings}
          onView={setSelected}
          onCancel={action("cancel")}
          onConfirm={action("confirmed")}
          onComplete={action("completed")}
          onReschedule={action("reschedule")}
        />
      ) : (
        <div className="empty-panel">
          No bookings found. There are no bookings matching your filters.
        </div>
      )}
      {selected && (
        <Modal title="Booking details" onClose={() => setSelected(null)}>
          <BookingDetails
            booking={selected}
            onAction={update}
            onReschedule={() => beginReschedule(selected)}
          />
        </Modal>
      )}
      {cancelTarget && (
        <Modal title="Cancel booking?" onClose={() => setCancelTarget(null)}>
          <div className="confirm-dialog">
            <p>
              Are you sure you want to cancel <strong>{cancelTarget.id}</strong>{" "}
              for {cancelTarget.customer}?
            </p>
            <div>
              <button className="button danger" onClick={cancel}>
                Cancel booking
              </button>
              <button
                className="button outline"
                onClick={() => setCancelTarget(null)}>
                Keep booking
              </button>
            </div>
          </div>
        </Modal>
      )}
      {rescheduleTarget && (
        <Modal
          title="Reschedule booking"
          onClose={() => setRescheduleTarget(null)}>
          <form className="form-card modal-form" onSubmit={saveReschedule}>
            <p>
              Choose a new available slot for{" "}
              <strong>{rescheduleTarget.id}</strong>.
            </p>
            <label>
              Date
              <input
                type="date"
                min="2026-09-18"
                value={reschedule.date}
                onChange={(event) =>
                  setReschedule({ ...reschedule, date: event.target.value })
                }
              />
            </label>
            <label>
              Court
              <select
                value={reschedule.courtId}
                onChange={(event) =>
                  setReschedule({ ...reschedule, courtId: event.target.value })
                }>
                <option value="court-1">Court 1</option>
                <option value="court-2">Court 2</option>
              </select>
            </label>
            <label>
              Start time
              <select
                value={reschedule.time}
                onChange={(event) =>
                  setReschedule({ ...reschedule, time: event.target.value })
                }>
                {[
                  "07:00",
                  "08:00",
                  "09:00",
                  "10:00",
                  "11:00",
                  "12:00",
                  "13:00",
                  "14:00",
                  "15:00",
                  "16:00",
                  "17:00",
                  "18:00",
                  "19:00",
                  "20:00",
                  "21:00",
                ].map((time) => (
                  <option key={time}>{time}</option>
                ))}
              </select>
            </label>
            <button className="button" type="submit">
              Save reschedule
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
