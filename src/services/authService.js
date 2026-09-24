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
    .select("id, full_name, email, phone, role, created_at, updated_at")
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
  if (String(newPassword || "").length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * Re-authenticate the CURRENT user with their existing password before a
 * sensitive change (password change). A live session alone must not be enough
 * to change the password — a hijacked/unlocked session would otherwise be
 * able to lock the real owner out.
 *
 * Resolves silently on success; throws a friendly error on a wrong password so
 * the caller can surface "Current password is incorrect".
 */
export async function verifyPassword(password) {
  assertSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user?.email) throw new Error("You must be signed in to do that.");
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: String(password || ""),
  });
  if (error) {
    throw new Error("Current password is incorrect.");
  }
}

export async function updateProfile({ fullName, phone }) {
  assertSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const { data, error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone })
    .eq("id", authData.user.id)
    .select("id, full_name, email, phone, role, created_at, updated_at")
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
  verifyPassword,
  updateProfile,
  getProfile,
  toAppUser,
};
