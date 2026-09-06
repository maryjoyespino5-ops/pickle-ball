import { supabase, isSupabaseConfigured } from "../lib/supabase";

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
  }
}

/** Map a `profiles` row into the shape the rest of the app expects. */
export function toAppUser(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    phone: profile.phone || "",
    role: profile.role,
  };
}

export async function getProfile(userId) {
  assertSupabase();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function signIn({ email, password }) {
  assertSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || "").trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  const profile = await getProfile(data.user.id);
  return toAppUser(profile);
}

export async function signUp({ fullName, email, phone, password }) {
  assertSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: String(email || "").trim().toLowerCase(),
    password,
    options: {
      data: {
        full_name: fullName,
        phone: phone || "",
      },
    },
  });
  if (error) throw error;

  if (data.session) {
    const profile = await getProfile(data.user.id);
    return { user: toAppUser(profile), requiresEmailConfirmation: false };
  }

  // The project has email confirmation enabled, so we do not get a session
  // until the user confirms their email address.
  return {
    user: {
      id: data.user?.id,
      fullName,
      email: data.user?.email || email,
      phone: phone || "",
      role: "customer",
    },
    requiresEmailConfirmation: true,
  };
}

export async function signOut() {
  assertSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function requestPasswordReset(email) {
  assertSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(
    String(email || "").trim().toLowerCase(),
    { redirectTo: `${window.location.origin}/reset-password` },
  );
  if (error) throw error;
  return { email, sent: true };
}

export async function updatePassword(newPassword) {
  assertSupabase();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function updateProfile({ fullName, phone }) {
  assertSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone })
    .eq("id", authData.user.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export const authService = {
  signIn,
  signUp,
  signOut,
  requestPasswordReset,
  updatePassword,
  updateProfile,
  getProfile,
  toAppUser,
};
