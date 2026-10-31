import { Link } from "react-router-dom";
export function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <Link className="brand" to="/">
          <img className="brand-mark" src="/favicon.png" alt="Your Pickle Ball logo" />
          <span>Your Pickle Ball</span>
        </Link>
        <p>Good games start with a good court.</p>
      </div>
      <div className="footer-links">
        <Link to="/courts">Courts</Link>
        <Link to="/pricing">Pricing</Link>
        <Link to="/contact">Contact</Link>
        <Link to="/book-court">Book a court</Link>
        <Link to="/booking">My booking</Link>
      </div>
      <small>© 2026 Your Pickle Ball</small>
    </footer>
  );
}
