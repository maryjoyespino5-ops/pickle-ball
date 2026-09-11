import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { bookingService } from "../../services/bookingService";
import { todayISO } from "../../utils/dateUtils";
import { Icon } from "../common/Icon";

const titles = {
  "/admin": "Dashboard",
  "/admin/bookings": "Bookings",
  "/admin/calendar": "Calendar",
  "/admin/courts": "Courts",
  "/admin/customers": "Customers",
  "/admin/payments": "Payments",
  "/admin/reports": "Reports",
  "/admin/settings": "Settings",
};
export function AdminTopbar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [todayPending, setTodayPending] = useState([]);
  const todayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
  const initials = (user?.fullName || "Admin")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  // Real notification source: bookings still pending confirmation today.
  useEffect(() => {
    let mounted = true;
    bookingService
      .getAllBookings({ date: todayISO(), status: "upcoming" })
      .then((rows) => {
        if (!mounted) return;
        setTodayPending(rows.slice(0, 5));
        setPendingCount(rows.length);
      })
      .catch(() => {
        if (mounted) {
          setTodayPending([]);
          setPendingCount(0);
        }
      });
    return () => {
      mounted = false;
    };
  }, [pathname]);
  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error(err);
    }
    navigate("/login");
  };
  return (
    <header className="admin-topbar">
      <div>
        <img
          className="admin-topbar-logo"
          src="/favicon.png"
          alt="Alicayard Pickle Ball logo"
        />
        <span className="admin-kicker">ADMIN WORKSPACE</span>
        <h1>{titles[pathname] || "Dashboard"}</h1>
      </div>
      <div className="admin-top-actions">
        <span className="admin-today">{todayLabel}</span>
        <button
          className="notification-button"
          aria-label={
            pendingCount > 0
              ? `${pendingCount} upcoming bookings today`
              : "No upcoming bookings today"
          }
          onClick={() =>
            setOpen(open === "notifications" ? null : "notifications")
          }>
          <Icon name="bell" size={20} />
          {pendingCount > 0 && (
            <span className="notification-badge" aria-hidden="true">
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </button>
        {open === "notifications" && (
          <div className="topbar-popover notifications-popover">
            <strong>Notifications</strong>
            {todayPending.length === 0 ? (
              <p>
                <b>All caught up</b>
                <small>No upcoming bookings left today.</small>
              </p>
            ) : (
              todayPending.map((booking) => (
                <p key={booking.id}>
                  <b>
                    {booking.courtName} booked for {booking.time}
                  </b>
                  <small>
                    {booking.id} · {booking.customer}
                  </small>
                </p>
              ))
            )}
          </div>
        )}
        <button
          className="admin-profile admin-profile-button"
          onClick={() => setOpen(open === "profile" ? null : "profile")}>
          <span className="admin-avatar" aria-hidden="true">{initials}</span>
          <span>
            <strong>{user?.fullName || "Admin"}</strong>
            <small>Administrator</small>
          </span>
        </button>
        {open === "profile" && (
          <div className="topbar-popover profile-popover">
            <Link to="/admin/settings">Profile</Link>
            <Link to="/admin/settings">Settings</Link>
            <button onClick={handleLogout}>Logout</button>
          </div>
        )}
      </div>
    </header>
  );
}
