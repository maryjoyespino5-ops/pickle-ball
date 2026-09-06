import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AdminBookingTable } from "../../components/dashboard/AdminBookingTable";
import { StatCard } from "../../components/dashboard/StatCard";
import { BookingDetails } from "../../components/booking/BookingDetails";
import { CourtStatus } from "../../components/courts/CourtStatus";
import { Modal } from "../../components/common/Modal";
import { bookingService } from "../../services/bookingService";
import { courtService } from "../../services/courtService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12, formatTimeRange12 } from "../../utils/dateUtils";

import { useAuth } from "../../hooks/useAuth";

function toIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const today = toIsoDate(new Date());

export function Dashboard() {
  const { user } = useAuth();
  const firstName = (user?.fullName || "Alex").split(" ")[0];
  const [bookings, setBookings] = useState([]);
  const [courts, setCourts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    Promise.all([
      bookingService.getAllBookings({ date: today }),
      courtService.getManagedCourts(),
    ]).then(([nextBookings, nextCourts]) => {
      setBookings(nextBookings);
      setCourts(nextCourts);
    });
  }, []);
  const update = async (action, booking = selected) => {
    if (!booking) return;
    if (action === "cancelled") {
      setCancelTarget(booking);
      return;
    }
    const next = await bookingService.updateBooking(
      booking.id,
      action === "paid" ? { paymentStatus: "paid" } : { status: action },
    );
    setBookings((items) =>
      items.map((item) => (item.id === next.id ? next : item)),
    );
    setSelected(next);
  };
  const active = bookings.filter((item) => item.status !== "cancelled");
  // "Occupied" = a court with a non-cancelled booking today; maintenance
  // courts are never counted as available.
  const occupiedIds = new Set(active.map((item) => item.courtId));
  const availableCount = courts.filter(
    (court) => !occupiedIds.has(court.id) && court.status !== "maintenance",
  ).length;
  const occupiedCount = occupiedIds.size;
  const todayRevenue = active.reduce((sum, item) => sum + item.amount, 0);
  const courtBooking = (courtId) => active.find((item) => item.courtId === courtId);
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }).toUpperCase()}
          </span>
          <h2>Good morning, {firstName}.</h2>
          <p>Here is what is happening with your courts today.</p>
        </div>
        <span className="live-pill">
          <i /> Live overview
        </span>
      </div>
      <div className="admin-stat-grid">
        <StatCard label="Today's bookings" value={bookings.length} />
        <StatCard label="Today's revenue" value={formatCurrency(todayRevenue)} />
        <StatCard label="Available courts" value={availableCount} />
        <StatCard label="Booked courts" value={occupiedCount} />
      </div>
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <span className="admin-kicker">LIVE STATUS</span>
            <h3>Today's court status</h3>
          </div>
        </div>
        <div className="court-status-grid">
          {courts.map((court) => (
            <article className="admin-court-status" key={court.id}>
              <div>
                <span className="admin-court-visual">
                  {court.name.replace("Court ", "0")}
                </span>
                <div>
                  <strong>{court.name}</strong>
                  <CourtStatus
                    status={
                      courtBooking(court.id) ? "occupied" : court.status
                    }
                    detail={
                      courtBooking(court.id)
                        ? formatTimeRange12(
                            courtBooking(court.id).time,
                            courtBooking(court.id).duration,
                          )
                        : court.status === "maintenance"
                          ? "Under maintenance"
                          : "Ready for booking"
                    }
                  />
                </div>
              </div>
              <button
                className="court-arrow court-link-button"
                onClick={() => navigate("/admin/courts")}>
                -&gt;
              </button>
            </article>
          ))}
        </div>
      </section>
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <span className="admin-kicker">TODAY</span>
            <h3>Today's bookings</h3>
          </div>
          <Link to="/admin/bookings" className="admin-inline-link">
            View all bookings -&gt;
          </Link>
        </div>
        <AdminBookingTable
          bookings={bookings}
          onView={setSelected}
          onCancel={(booking) => setSelected(booking)}
          onConfirm={(booking) => update("confirmed", booking)}
          onComplete={(booking) => update("completed", booking)}
          onReschedule={() => navigate("/admin/bookings")}
        />
      </section>
      <section className="admin-section recent-activity">
        <div className="admin-section-heading">
          <div>
            <span className="admin-kicker">RECENT ACTIVITY</span>
            <h3>Keep an eye on the details</h3>
          </div>
          <Link className="admin-inline-link" to="/admin/customers">
            View customers -&gt;
          </Link>
        </div>
        <div className="activity-list">
          {bookings.slice(0, 4).map((booking) => (
            <Link key={booking.id} to="/admin/bookings">
              <span
                className={`activity-dot ${booking.status === "cancelled" ? "yellow" : "green"}`}
              />
              {booking.status === "cancelled"
                ? `Booking cancelled · ${booking.customer}`
                : `New booking ${booking.id} · ${booking.customer}`}
              <small>
                {booking.courtName} · {booking.date} {formatTime12(booking.time)}
              </small>
            </Link>
          ))}
          {bookings.length === 0 && (
            <div className="empty-panel">No bookings yet today.</div>
          )}
        </div>
      </section>
      {selected && (
        <Modal
          title={
            selected.status === "confirmed"
              ? "Booking details"
              : "Manage booking"
          }
          onClose={() => setSelected(null)}>
          <BookingDetails
            booking={selected}
            onAction={update}
            onReschedule={() => navigate("/admin/bookings")}
          />
        </Modal>
      )}
      {cancelTarget && (
        <Modal title="Cancel booking?" onClose={() => setCancelTarget(null)}>
          <div className="confirm-dialog">
            <p>
              Are you sure you want to cancel <strong>{cancelTarget.id}</strong>
              ?
            </p>
            <div>
              <button
                className="button danger"
                onClick={async () => {
                  const next = await bookingService.updateBooking(
                    cancelTarget.id,
                    { status: "cancelled" },
                  );
                  setBookings((items) =>
                    items.map((item) => (item.id === next.id ? next : item)),
                  );
                  setCancelTarget(null);
                }}>
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
    </div>
  );
}
