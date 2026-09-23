import { useSubscription } from "../context/SubscriptionContext";

/** Convenience hook: pages disable write actions while the license is expired. */
export function useSubscriptionLock() {
  const { isActive, loading, subscription, refresh, error } = useSubscription();
  return { locked: !isActive, loading, subscription, refresh, error };
}
