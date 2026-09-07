import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { BookingTable } from "../../components/dashboard/BookingTable";
import { useBookings } from "../../hooks/useBookings";
import { useScrollReveal } from "../../hooks/useScrollReveal";
export function MyBookings() {
  const { bookings, loading, error, cancel } = useBookings();
  useScrollReveal();
  const location = useLocation();
  const [justBooked] = useState(() => Boolean(location.state?.justBooked));
  const [notice, setNotice] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const handleCancel = async (id) => {
    setCancelError("");
    try {
      await cancel(id);
      setNotice(true);
    } catch (err) {
      setCancelError(err.message || "Could not cancel the booking.");
    }
  };
  return (
    <main className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR PICKLEBALL</span>
          <h1>My bookings</h1>
          <p>Keep track of every hour you have reserved.</p>
        </div>
        <Button to="/book">
          Book a court <span aria-hidden="true">-&gt;</span>
        </Button>
      </div>
      {justBooked && (
        <div className="success-message">Your court is booked. See you on court!</div>
      )}
      {notice && (
        <div className="success-message">Booking cancelled successfully.</div>
      )}
      {cancelError && <ErrorMessage message={cancelError} />}
      {loading ? (
        <p className="loading-state">Loading bookings...</p>
      ) : (
        <BookingTable
          bookings={bookings.filter((booking) =>
            ["upcoming", "confirmed"].includes(booking.status),
          )}
          onCancel={handleCancel}
        />
      )}
    </main>
  );
}
