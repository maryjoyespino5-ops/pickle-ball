import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Button } from "../common/Button";
import { useAuth } from "../../hooks/useAuth";

export function Navbar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile menu automatically whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <header className="site-header">
      <Link className="brand" to="/">
        <img
          className="brand-mark"
          src="/favicon.png"
          alt="Alicayard Pickle Ball logo"
        />
        {/* Full name on wide screens; a short label on phones so the header
            stays one compact row instead of wrapping or clipping the name.
            Only one of the two is ever visible, so the link's accessible name
            stays exactly "Alicayard Pickle Ball". */}
        <span className="brand-full">Alicayard Pickle Ball</span>
        <span className="brand-short" aria-hidden="true">
          Alicayard
        </span>
      </Link>
      <nav
        className={`public-nav${navOpen ? " open" : ""}`}
        id="public-nav"
        aria-label="Main navigation">
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
            {/* Guests book straight on the landing page — no account needed. */}
            <Button to="/#book">
              Book a court <span aria-hidden="true">-&gt;</span>
            </Button>
          </>
        )}
        <button
          type="button"
          className="nav-toggle"
          aria-label={
            navOpen ? "Close navigation menu" : "Open navigation menu"
          }
          aria-expanded={navOpen}
          aria-controls="public-nav"
          onClick={() => setNavOpen(!navOpen)}>
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true">
            {navOpen ? (
              <path d="M6 5l12 12M18 5l-12 12" />
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>
    </header>
  );
}
