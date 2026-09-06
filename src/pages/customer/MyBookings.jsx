import { useState } from "react";
import { Button } from "../../components/common/Button";
import { BookingTable } from "../../components/dashboard/BookingTable";
import { useBookings } from "../../hooks/useBookings";
export function MyBookings() {
  const { bookings, loading, cancel } = useBookings();
  const [notice, setNotice] = useState(false);
  const handleCancel = async (id) => {
    await cancel(id);
    setNotice(true);
  };
  return (
    <main className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR RALLY</span>
          <h1>My bookings</h1>
          <p>Keep track of every hour you have reserved.</p>
        </div>
        <Button to="/book">
          Book a court <span aria-hidden="true">-&gt;</span>
        </Button>
      </div>
      {notice && (
        <div className="success-message">Booking cancelled successfully.</div>
      )}
      {loading ? (
        <p className="loading-state">Loading bookings...</p>
      ) : (
        <BookingTable
          bookings={bookings.filter((booking) => booking.status === "upcoming")}
          onCancel={handleCancel}
        />
      )}
    </main>
  );
}
