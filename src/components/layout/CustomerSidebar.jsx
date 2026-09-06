import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
export function CustomerSidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate("/login");
  };
  return (
    <aside className="customer-sidebar">
      <div className="sidebar-label">MY RALLY</div>
      <nav>
        <NavLink end to="/dashboard">
          Dashboard
        </NavLink>
        <NavLink to="/book">Book a court</NavLink>
        <NavLink to="/my-bookings">My bookings</NavLink>
        <NavLink to="/history">Booking history</NavLink>
        <NavLink to="/profile">Profile</NavLink>
      </nav>
      <button className="sidebar-logout" onClick={handleLogout}>
        Log out
      </button>
    </aside>
  );
}
