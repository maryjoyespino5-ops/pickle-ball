import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { subscriptionService } from "../services/subscriptionService";

const SubscriptionContext = createContext({
  subscription: null,
  loading: true,
  error: "",
  isActive: true,
  refresh: async () => null,
});

/**
 * Server-driven license state for the signed-in admin. The verdict comes
 * from Supabase (`subscription_status()` RPC); nothing here is stored in
 * localStorage, and nothing here can grant access — the database write-guard
 * is the real enforcement. This context only decides what the UI shows.
 */
export function SubscriptionProvider({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    // Only admins need license state; customers/public skip the check.
    if (!user || user.role !== "admin") {
      setSubscription(null);
      setError("");
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      // Mark lapsed licenses expired server-side (audit trail), then read.
      const next = await subscriptionService.refreshSubscriptionStatus().catch(() =>
        subscriptionService.getSubscriptionStatus(),
      );
      setSubscription(next);
      setError("");
      return next;
    } catch (err) {
      // Reads stay available even if the check fails (offline / RLS hiccup):
      // fail OPEN for viewing, the DB still blocks writes when expired.
      setError(err?.message || "Could not check the subscription.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  // Re-check every 5 minutes so an expiry mid-shift locks actions promptly.
  useEffect(() => {
    if (!user || user.role !== "admin") return undefined;
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [user, load]);

  const value = useMemo(
    () => ({
      subscription,
      loading,
      error,
      // Unknown state (load failure) must not lock the admin out of reads.
      isActive: subscription ? subscription.isActive : true,
      refresh: load,
    }),
    [subscription, loading, error, load],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSubscription() {
  return useContext(SubscriptionContext);
}
