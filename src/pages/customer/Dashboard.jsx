import { Link } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { StatCard } from "../../components/dashboard/StatCard";
import { BookingCard } from "../../components/booking/BookingCard";
import { useAuth } from "../../hooks/useAuth";
import { useBookings } from "../../hooks/useBookings";
export function Dashboard() {
  const { user } = useAuth();
  const { bookings } = useBookings();
  const next = bookings.find((booking) => booking.status === "upcoming");
  return (
    <main className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR DASHBOARD</span>
          <h1>Good morning, {user?.fullName?.split(" ")[0] || "player"}.</h1>
          <p>Ready for your next game?</p>
        </div>
        <Button to="/book">
          Book a court <span aria-hidden="true">-&gt;</span>
        </Button>
      </div>
      <div className="stat-grid">
        <StatCard label="Total bookings" value={bookings.length} />
        <StatCard
          label="Hours played"
          value={`${bookings.filter((item) => item.status === "completed").length}h`}
        />
        <StatCard label="Favorite court" value="Court 1" />
      </div>
      <div className="dashboard-grid">
        <section>
          <div className="section-heading small">
            <div>
              <span className="eyebrow">UP NEXT</span>
              <h2>Your next game</h2>
            </div>
            <Link className="arrow-link" to="/my-bookings">
              All bookings <span aria-hidden="true">-&gt;</span>
            </Link>
          </div>
          {next ? (
            <BookingCard booking={next} />
          ) : (
            <div className="empty-panel">
              No upcoming bookings yet.{" "}
              <Link to="/book">Book your first game.</Link>
            </div>
          )}
        </section>
        <section className="dashboard-note">
          <span className="eyebrow">YOUR RALLY TIP</span>
          <h2>
            Bring the energy.
            <br />
            <em>Leave the stress.</em>
          </h2>
          <p>Your court is waiting. All you need to bring is your game.</p>
        </section>
      </div>
    </main>
  );
}
