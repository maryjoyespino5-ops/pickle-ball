import { supabase, isSupabaseConfigured } from "../lib/supabase";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

function toAppSettings(row) {
  return {
    facilityName: row.facility_name,
    address: row.address,
    contact: row.contact || "",
    facilityEmail: row.facility_email,
    opening: String(row.opening_time).slice(0, 5),
    closing: String(row.closing_time).slice(0, 5),
    defaultDuration: String(row.default_duration),
    maxDuration: String(row.max_duration),
  };
}

/* ---------------------------------------------------------------------------
 * Facility settings live in a single-row `facility_settings` table that only
 * admins can read or update (RLS).
 * ------------------------------------------------------------------------ */

export async function getFacilitySettings() {
  assertSupabase();
  const { data, error } = await supabase
    .from("facility_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? toAppSettings(data) : null;
}

export async function updateFacilitySettings(values) {
  assertSupabase();
  const { data, error } = await supabase
    .from("facility_settings")
    .update({
      facility_name: values.facilityName,
      address: values.address,
      contact: values.contact,
      facility_email: values.facilityEmail,
      opening_time: values.opening,
      closing_time: values.closing,
      default_duration: Number(values.defaultDuration),
      max_duration: Number(values.maxDuration),
      updated_at: new Date().toISOString(),
    })
    .eq("id", true)
    .select("*")
    .single();
  if (error) throw error;
  return toAppSettings(data);
}

export const settingsService = { getFacilitySettings, updateFacilitySettings };