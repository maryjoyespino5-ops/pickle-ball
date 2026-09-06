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

const today = "2026-09-18";
export function Dashboard() {
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
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">SUNDAY, SEPTEMBER 18, 2026</span>
          <h2>Good morning, Alex.</h2>
          <p>Here is what is happening with your courts today.</p>
        </div>
        <span className="live-pill">
          <i /> Live overview
        </span>
      </div>
      <div className="admin-stat-grid">
        <StatCard label="Today's bookings" value={bookings.length} />
        <StatCard
          label="Today's revenue"
          value={formatCurrency(active.length * 300)}
        />
        <StatCard label="Available courts" value="1" />
        <StatCard label="Booked courts" value="1" />
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
                    status={court.status}
                    detail={
                      court.status === "occupied"
                        ? "6:00 PM - 7:00 PM"
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
          <Link to="/admin/customers">
            <span className="activity-dot green" />
            New customer registered <small>Maria Santos · 12 min ago</small>
          </Link>
          <Link to="/admin/payments">
            <span className="activity-dot yellow" />
            Payment received <small>PB-002 · 28 min ago</small>
          </Link>
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
