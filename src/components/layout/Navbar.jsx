import { Link, NavLink } from "react-router-dom";
import { Button } from "../common/Button";
import { useAuth } from "../../hooks/useAuth";

export function Navbar() {
  const { user } = useAuth();
  return (
    <header className="site-header">
      <Link className="brand" to="/">
        <span className="brand-mark">A</span>
        <span>Alicayard Pickle Ball</span>
      </Link>
      <nav className="public-nav">
        <NavLink to="/courts">Courts</NavLink>
        <NavLink to="/availability">Availability</NavLink>
        <NavLink to="/pricing">Pricing</NavLink>
        <NavLink to="/contact">Contact</NavLink>
      </nav>
      <div className="header-actions">
        {user ? (
          <>
            <Link className="header-login" to="/dashboard">
              My dashboard
            </Link>
            <Button to="/book">
              Book a court <span aria-hidden="true">-&gt;</span>
            </Button>
          </>
        ) : (
          <>
            <Link className="header-login" to="/login">
              Log in
            </Link>
            <Button to="/book">
              Book a court <span aria-hidden="true">-&gt;</span>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
