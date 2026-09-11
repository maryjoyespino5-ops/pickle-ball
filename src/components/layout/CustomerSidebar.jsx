import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { Icon } from "../common/Icon";
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
          <span className="sidebar-ico">
            <Icon name="dashboard" size={18} />
          </span>
          Dashboard
        </NavLink>
        <NavLink to="/book">
          <span className="sidebar-ico">
            <Icon name="court" size={18} />
          </span>
          Book a court
        </NavLink>
        <NavLink to="/my-bookings">
          <span className="sidebar-ico">
            <Icon name="bookings" size={18} />
          </span>
          My bookings
        </NavLink>
        <NavLink to="/history">
          <span className="sidebar-ico">
            <Icon name="history" size={18} />
          </span>
          Booking history
        </NavLink>
        <NavLink to="/payments">
          <span className="sidebar-ico">
            <Icon name="payments" size={18} />
          </span>
          Payments
        </NavLink>
        <NavLink to="/profile">
          <span className="sidebar-ico">
            <Icon name="profile" size={18} />
          </span>
          Profile
        </NavLink>
      </nav>
      <button className="sidebar-logout" onClick={handleLogout}>
        <span className="sidebar-ico">
          <Icon name="logout" size={18} />
        </span>
        Log out
      </button>
    </aside>
  );
}
