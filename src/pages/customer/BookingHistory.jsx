import { useState } from "react";
import { BookingTable } from "../../components/dashboard/BookingTable";
import { useBookings } from "../../hooks/useBookings";
export function BookingHistory() {
  const { bookings, loading } = useBookings();
  const [filter, setFilter] = useState("all");
  const history = bookings.filter(
    (booking) =>
      booking.status !== "upcoming" &&
      (filter === "all" || booking.status === filter),
  );
  return (
    <main className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR RALLY</span>
          <h1>Booking history</h1>
          <p>A record of the games you have played.</p>
        </div>
      </div>
      <div className="filter-tabs">
        {["all", "completed", "cancelled"].map((item) => (
          <button
            className={filter === item ? "active" : ""}
            key={item}
            onClick={() => setFilter(item)}>
            {item}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="loading-state">Loading history...</p>
      ) : history.length ? (
        <BookingTable bookings={history} />
      ) : (
        <div className="empty-panel">No bookings in this category yet.</div>
      )}
    </main>
  );
}
