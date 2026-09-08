import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
export function CustomerSidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error(err);
    }
    navigate("/login");
  };
  return (
    <aside className="customer-sidebar">
      <div className="sidebar-label">MY PICKLEBALL</div>
      <nav>
        <NavLink end to="/dashboard">
          <span className="sidebar-ico">🏠</span>
          Dashboard
        </NavLink>
        <NavLink to="/book">
          <span className="sidebar-ico">🎾</span>
          Book a court
        </NavLink>
        <NavLink to="/my-bookings">
          <span className="sidebar-ico">📅</span>
          My bookings
        </NavLink>
        <NavLink to="/history">
          <span className="sidebar-ico">🕘</span>
          Booking history
        </NavLink>
        <NavLink to="/payments">
          <span className="sidebar-ico">💳</span>
          Payments
        </NavLink>
        <NavLink to="/profile">
          <span className="sidebar-ico">👤</span>
          Profile
        </NavLink>
      </nav>
      <button className="sidebar-logout" onClick={handleLogout}>
        Log out
      </button>
    </aside>
  );
}
