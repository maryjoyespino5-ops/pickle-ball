import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Global scroll reset for SPA navigation.
 *
 * Mounted once (inside <BrowserRouter> in App.jsx) so every route change —
 * push, replace, and browser back/forward — opens the new page at the top.
 * No per-page scroll code is needed anywhere in the app.
 *
 * In-page anchors (e.g. "Book a court" linking to /#book on the landing page)
 * scroll to their section instead.
 *
 * `scrollRestoration = "manual"` stops the browser from restoring stale
 * scroll positions on back/forward, which would fight this reset in a
 * client-side-routed app.
 */
export function ScrollToTop() {
  const location = useLocation();
  const { pathname, hash } = location;

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  // Anchor navigation: /#book (navbar + hero) lands on the booking section.
  useEffect(() => {
    const id = hash.replace(/^#/, "");
    if (!id) return;
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [hash]);

  return null;
}
