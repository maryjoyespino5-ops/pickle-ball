import { Link, NavLink } from "react-router-dom";
import { Button } from "../common/Button";

export function Navbar() {
  return (
    <header className="site-header">
      <Link className="brand" to="/">
        <span className="brand-mark">R</span>
        <span>Rally Court Club</span>
      </Link>
      <nav className="public-nav">
        <NavLink to="/courts">Courts</NavLink>
        <NavLink to="/availability">Availability</NavLink>
        <NavLink to="/pricing">Pricing</NavLink>
        <NavLink to="/contact">Contact</NavLink>
      </nav>
      <div className="header-actions">
        <Link className="header-login" to="/login">
          Log in
        </Link>
        <Button to="/book">
          Book a court <span aria-hidden="true">-&gt;</span>
        </Button>
      </div>
    </header>
  );
}
