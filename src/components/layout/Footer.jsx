import { Link } from "react-router-dom";
export function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <Link className="brand" to="/">
          <span className="brand-mark">A</span>
          <span>Alicayard Pickle Ball</span>
        </Link>
        <p>Good games start with a good court.</p>
      </div>
      <div className="footer-links">
        <Link to="/courts">Courts</Link>
        <Link to="/pricing">Pricing</Link>
        <Link to="/contact">Contact</Link>
      </div>
      <small>© 2026 Alicayard Pickle Ball</small>
    </footer>
  );
}
