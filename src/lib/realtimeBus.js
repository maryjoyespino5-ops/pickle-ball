import { supabase, isSupabaseConfigured } from "./supabase";

/**
 * Single shared Realtime subscription for the whole app (P5).
 *
 * Instead of every page opening its own `bookings-changes` channel, all pages
 * subscribe here. One channel is opened on first use and disposed when the
 * last subscriber leaves, so customers never download/keep multiple sockets.
 *
 * When a customer is signed in we attach a Postgres changes filter
 * (`user_id=eq.<id>`) so the socket only receives that customer's own booking
 * events (S4) — admins keep the unfiltered channel.
 *
 * Events are debounced (350 ms) so a burst of changes triggers one refetch.
 */

let currentUser = null;
const subscribers = new Set();
let channel = null;
let timer = null;

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    subscribers.forEach((handler) => handler());
  }, 350);
}

function teardown() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (channel) {
    try {
      supabase.removeChannel(channel);
    } catch {
      // channel already removed
    }
    channel = null;
  }
}

function connect() {
  if (!isSupabaseConfigured || !supabase || channel) return;
  const filter =
    currentUser && currentUser.role !== "admin"
      ? `user_id=eq.${currentUser.id}`
      : undefined;
  const config = { event: "*", schema: "public", table: "bookings" };
  if (filter) config.filter = filter;
  channel = supabase
    .channel("bookings-changes-global")
    .on("postgres_changes", config, schedule)
    .subscribe();
}

export function setRealtimeUser(user) {
  const next =
    user &&
    typeof user === "object" &&
    user.id !== undefined &&
    user.role !== undefined
      ? { id: user.id, role: user.role }
      : null;
  if (
    next?.id === currentUser?.id &&
    next?.role === currentUser?.role
  ) {
    return;
  }
  currentUser = next;
  teardown();
  if (subscribers.size > 0) connect();
}

/**
 * Register a handler; returns an unsubscribe function.
 */
export function subscribeRealtime(handler) {
  subscribers.add(handler);
  connect();
  return () => {
    subscribers.delete(handler);
    if (subscribers.size === 0) teardown();
  };
}