import { Link, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";

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
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const logout = () => {
    localStorage.removeItem("rally-auth-user");
    navigate("/login");
    window.location.reload();
  };
  return (
    <header className="admin-topbar">
      <div>
        <span className="admin-kicker">ADMIN WORKSPACE</span>
        <h1>{titles[pathname] || "Dashboard"}</h1>
      </div>
      <div className="admin-top-actions">
        <span className="admin-today">Sunday, September 6, 2026</span>
        <button
          className="notification-button"
          aria-label="Notifications"
          onClick={() =>
            setOpen(open === "notifications" ? null : "notifications")
          }>
          ♢<i />
        </button>
        {open === "notifications" && (
          <div className="topbar-popover notifications-popover">
            <strong>Notifications</strong>
            <p>
              <b>New booking received</b>
              <small>Court 1 booked for 6:00 PM</small>
            </p>
            <p>
              <b>Payment received</b>
              <small>Booking PB-002 has been paid</small>
            </p>
          </div>
        )}
        <button
          className="admin-profile admin-profile-button"
          onClick={() => setOpen(open === "profile" ? null : "profile")}>
          <span className="admin-avatar">AR</span>
          <span>
            <strong>{user?.fullName || "Admin"}</strong>
            <small>Administrator</small>
          </span>
        </button>
        {open === "profile" && (
          <div className="topbar-popover profile-popover">
            <Link to="/admin/settings">Profile</Link>
            <Link to="/admin/settings">Settings</Link>
            <button onClick={logout}>Logout</button>
          </div>
        )}
      </div>
    </header>
  );
}
