import { useEffect, useRef } from "react";
import { subscribeRealtime } from "../lib/realtimeBus";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

/**
 * Subscribe to INSERT / UPDATE / DELETE events on the `bookings` table so the
 * customer and admin sides stay in sync without a manual refresh.
 *
 * There is exactly one source of truth: the Supabase `bookings` table. When a
 * customer books, cancels, or an admin reschedules, every subscribed screen
 * (customer dashboard, availability, admin calendar/dashboard) refetches.
 *
 * The real connection is managed by `src/lib/realtimeBus.js` — a single shared
 * channel for the whole app, filtered to the current customer (S4/P5). Events
 * are debounced so a burst of changes triggers a single refetch.
 */
export function useRealtimeBookings(onChange, enabled = true) {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !supabase) return undefined;
    const handler = () => callbackRef.current?.();
    return subscribeRealtime(handler);
  }, [enabled]);
}
