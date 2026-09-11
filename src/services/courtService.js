import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { COURT_HOURS } from "../lib/constants";
import { facilityService, buildCourtHours } from "./facilityService";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

function formatTime(value) {
  return String(value).slice(0, 5);
}

function toAppCourt(row) {
  return {
    id: row.id,
    name: row.name,
    accent: row.accent || "sunset",
    description: row.description || "",
    price: Number(row.price_per_hour),
  };
}

/* ---------------------------------------------------------------------------
 * Customer/public side (Supabase-backed)
 * ------------------------------------------------------------------------ */

export async function getCourts() {
  assertSupabase();
  const { data, error } = await supabase
    .from("courts")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data || []).map(toAppCourt);
}

export async function getAvailability(date) {
  assertSupabase();
  const { data: courtRows, error: courtsError } = await supabase
    .from("courts")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (courtsError) throw courtsError;

  // Use a security-definer RPC so anonymous visitors can see which slots are
  // taken without being able to read other customers' booking rows (RLS).
  const { data: bookedSlots, error: bookingsError } = await supabase.rpc(
    "get_booked_slots",
    { p_date: date },
  );
  if (bookingsError) throw bookingsError;

  // Build the hour slots from the facility's configured opening/closing.
  const settings = await facilityService.getPublicInfo().catch(() => null);
  const hours = buildCourtHours(settings);

  const busy = new Set(
    (bookedSlots || []).map(
      (item) => `${item.court_id}:${formatTime(item.start_time)}`,
    ),
  );

  return (courtRows || []).map((court) => ({
    ...toAppCourt(court),
    slots: hours.map((time) => ({
      time,
      available: !busy.has(`${court.id}:${time}`),
    })),
  }));
}

/* ---------------------------------------------------------------------------
 * Admin-side (Supabase-backed, RLS grants admins court management)
 * ------------------------------------------------------------------------ */

export async function getManagedCourts() {
  assertSupabase();
  const { data, error } = await supabase
    .from("courts")
    .select("*")
    .order("name");
  if (error) throw error;
  return (data || []).map((row) => ({
    ...toAppCourt(row),
    image: row.image || "court-default",
    maintenance: Boolean(row.maintenance),
    enabled: row.is_active !== false,
    status: row.maintenance
      ? "maintenance"
      : row.is_active === false
        ? "disabled"
        : "available",
  }));
}

export async function updateCourt(id, changes) {
  assertSupabase();
  const payload = {};
  if (changes.name !== undefined) payload.name = changes.name;
  if (changes.description !== undefined)
    payload.description = changes.description;
  if (changes.price !== undefined) payload.price_per_hour = Number(changes.price);
  if (changes.image !== undefined) payload.image = changes.image;
  if (changes.enabled !== undefined) payload.is_active = changes.enabled;
  if (changes.maintenance !== undefined) payload.maintenance = changes.maintenance;
  if (Object.keys(payload).length > 0) {
    const { error } = await supabase.from("courts").update(payload).eq("id", id);
    if (error) throw error;
  }
  return getManagedCourts();
}

export const courtService = {
  getCourts,
  getAvailability,
  getManagedCourts,
  updateCourt,
};
