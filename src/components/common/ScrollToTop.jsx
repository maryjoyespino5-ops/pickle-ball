import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Global scroll reset for SPA navigation.
 *
 * Mounted once (inside <BrowserRouter> in App.jsx) so every route change —
 * push, replace, and browser back/forward — opens the new page at the top.
 * No per-page scroll code is needed anywhere in the app.
 *
 * `scrollRestoration = "manual"` stops the browser from restoring stale
 * scroll positions on back/forward, which would fight this reset in a
 * client-side-routed app.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}
