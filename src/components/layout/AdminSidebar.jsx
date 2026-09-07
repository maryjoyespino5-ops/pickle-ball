import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

const groups = [
  {
    label: "BOOKING",
    links: [
      ["Dashboard", "/admin", "▦"],
      ["Bookings", "/admin/bookings", "▤"],
      ["Calendar", "/admin/calendar", "□"],
    ],
  },
  {
    label: "MANAGEMENT",
    links: [
      ["Courts", "/admin/courts", "◇"],
      ["Customers", "/admin/customers", "♙"],
      ["Payments", "/admin/payments", "₱"],
    ],
  },
  { label: "REPORTING", links: [["Reports", "/admin/reports", "⌁"]] },
  { label: "SYSTEM", links: [["Settings", "/admin/settings", "⚙"]] },
];

export function AdminSidebar() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate("/login");
  };
  return (
    <aside className="admin-sidebar">
      <div className="admin-brand">
        <img className="admin-brand-mark" src="/favicon.png" alt="Alicayard Pickle Ball logo" />
        <span>
          Pickleball
          <br />
          <strong>Admin</strong>
        </span>
      </div>
      <div className="admin-nav-groups">
        {groups.map((group) => (
          <div className="admin-nav-group" key={group.label}>
            <span className="admin-nav-label">{group.label}</span>
            {group.links.map(([label, to, icon]) => (
              <NavLink end={to === "/admin"} key={to} to={to}>
                <span className="admin-nav-icon">{icon}</span>
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <button className="admin-logout" onClick={handleLogout}>
        <span>↪</span> Logout
      </button>
    </aside>
  );
}
