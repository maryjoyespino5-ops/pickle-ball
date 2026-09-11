import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { COURT_HOURS } from "../lib/constants";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

const FALLBACK = {
  facilityName: "Alicayard Pickle Ball",
  address: "18 Palm Avenue, Makati, Metro Manila",
  contact: "+63 917 555 0188",
  facilityEmail: "hello@alicayardpickleball.ph",
  opening: "07:00",
  closing: "22:00",
  defaultDuration: 1,
  maxDuration: 2,
  minPrice: 300,
};

let cache = null;

function toAppInfo(row) {
  return {
    facilityName: row.facility_name,
    address: row.address,
    contact: row.contact || "",
    facilityEmail: row.facility_email,
    opening: String(row.opening_time || "07:00").slice(0, 5),
    closing: String(row.closing_time || "22:00").slice(0, 5),
    defaultDuration: Number(row.default_duration || 1),
    maxDuration: Number(row.max_duration || 2),
    minPrice: Number(row.min_price) || FALLBACK.minPrice,
  };
}

/** Build the list of bookable start hours from the facility opening/closing. */
export function buildCourtHours(settings) {
  const fallback = settings ? null : COURT_HOURS;
  if (fallback) return fallback;
  const start = Number(String(settings.opening).slice(0, 2));
  const end = Number(String(settings.closing).slice(0, 2));
  const hours = [];
  for (let hour = start; hour < end; hour += 1) {
    hours.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return hours.length > 0 ? hours : COURT_HOURS;
}

/**
 * Public facility information (hours + durations + min price). Backed by the
 * `get_facility_info` security-definer RPC so anonymous visitors can read it.
 * Falls back to the default constants if the RPC has not been deployed yet.
 * Cached for the life of the page session.
 */
export async function getPublicInfo() {
  assertSupabase();
  if (cache) return cache;
  try {
    const { data, error } = await supabase.rpc("get_facility_info");
    if (error) throw error;
    cache = toAppInfo(data[0]);
    return cache;
  } catch {
    cache = { ...FALLBACK };
    return cache;
  }
}

export function resetPublicInfoCache() {
  cache = null;
}

export const facilityService = { getPublicInfo, buildCourtHours };