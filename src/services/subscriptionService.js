import { supabase, isSupabaseConfigured } from "../lib/supabase";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

export const SUBSCRIPTION_FEE = 999;
export const SUBSCRIPTION_PERIOD_DAYS = 30;

/**
 * PayMongo Payment Link for the monthly license (₱999). Opening this link is
 * the ONLY browser-side action — the license is renewed exclusively by the
 * verified PayMongo webhook, so a frontend success message can never unlock
 * anything. The link is public; the PayMongo secret key stays server-side.
 */
export const PAYMONO_PAYMENT_LINK = String(
  import.meta.env.VITE_PAYMONO_PAYMENT_LINK ||
    "https://pm.link/org-k48NqbsmRhyB2a8HEyXdc9Wj/OqqZPix",
).trim();

/** True when a PayMongo payment link is configured. */
export function hasPaymongoLink() {
  return /^https?:\/\//.test(PAYMONO_PAYMENT_LINK);
}

/** True when a Supabase error came from the expired-license write guard. */
export function isSubscriptionExpiredError(error) {
  return String(error?.message || "").includes("SUBSCRIPTION_EXPIRED");
}

/**
 * Map raw Supabase errors to UI text. Expired-license blocks become a short
 * renewal prompt; everything else passes through untouched.
 */
export function subscriptionErrorMessage(error, fallback) {
  if (isSubscriptionExpiredError(error)) {
    return "Your software license has expired. Renew the subscription to continue.";
  }
  return error?.message || fallback || "Something went wrong. Try again.";
}

/**
 * Customer-facing copy for the same server-side block. Customers are not the
 * licensee, so they must never see license/renewal details — just a short
 * "temporarily unavailable" message pointing them at the facility.
 */
export function customerSubscriptionMessage(error, fallback) {
  if (isSubscriptionExpiredError(error)) {
    return "Online booking is temporarily unavailable. Please contact the facility to reserve a court.";
  }
  return error?.message || fallback || "Something went wrong. Try again.";
}

/**
 * Server-side license snapshot (single source of truth). Uses the
 * security-definer `subscription_status()` RPC so the verdict comes from the
 * database clock + license row — never from localStorage or browser state.
 */
export async function getSubscriptionStatus() {
  assertSupabase();
  const { data, error } = await supabase.rpc("subscription_status");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Subscription record is missing.");
  return {
    status: row.status,
    paymentStatus: row.payment_status,
    startDate: row.start_date,
    expiresAt: row.expires_at,
    lastPaymentAt: row.last_payment_at,
    lastAmount: row.last_amount == null ? null : Number(row.last_amount),
    graceDays: Number(row.grace_days) || 0,
    monthlyFee: Number(row.monthly_fee) || SUBSCRIPTION_FEE,
    isActive: Boolean(row.is_active),
    daysRemaining: row.days_remaining == null ? null : Number(row.days_remaining),
    updatedAt: row.updated_at,
  };
}

/** Ask the server to mark lapsed licenses expired (audit trail), then re-read. */
export async function refreshSubscriptionStatus() {
  assertSupabase();
  // Best-effort: older databases without migration 0014 lack this RPC.
  await supabase.rpc("refresh_subscription_status").then(({ error }) => {
    if (error) throw error;
  });
  return getSubscriptionStatus();
}

/** Read-only payment / renewal history for Admin > Subscription. */
export async function getSubscriptionPayments() {
  assertSupabase();
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("id, amount, method, reference, status, period_start, period_end, paid_at, created_at")
    .order("paid_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    method: row.method,
    reference: row.reference,
    status: row.status,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    paidAt: row.paid_at,
    createdAt: row.created_at,
  }));
}

/** Read-only license status-change log for Admin > Subscription. */
export async function getSubscriptionEvents() {
  assertSupabase();
  const { data, error } = await supabase
    .from("subscription_events")
    .select("id, event_type, old_status, new_status, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export const subscriptionService = {
  SUBSCRIPTION_FEE,
  SUBSCRIPTION_PERIOD_DAYS,
  PAYMONO_PAYMENT_LINK,
  hasPaymongoLink,
  isSubscriptionExpiredError,
  subscriptionErrorMessage,
  customerSubscriptionMessage,
  getSubscriptionStatus,
  refreshSubscriptionStatus,
  getSubscriptionPayments,
  getSubscriptionEvents,
};
