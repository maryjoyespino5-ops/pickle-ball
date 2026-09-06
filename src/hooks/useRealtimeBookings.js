import { useEffect, useRef } from "react";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

/**
 * Subscribe to INSERT / UPDATE / DELETE events on the `bookings` table so the
 * customer and admin sides stay in sync without a manual refresh.
 *
 * There is exactly one source of truth: the Supabase `bookings` table. When a
 * customer books, cancels, or an admin reschedules, every subscribed screen
 * (customer dashboard, availability, admin calendar/dashboard) refetches.
 *
 * Events are debounced so a burst of changes triggers a single refetch.
 */
export function useRealtimeBookings(onChange, enabled = true) {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  useEffect(() => {
    if (!enabled || !isSupabaseConfigured || !supabase) return undefined;

    let timer = null;
    const scheduleRefetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callbackRef.current?.(), 350);
    };

    const channel = supabase
      .channel("bookings-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        scheduleRefetch,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled]);
}
