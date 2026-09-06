import { useEffect, useState } from "react";
import { authService } from "../services/authService";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { AuthContext } from "./AuthContextValue";

function assertConfigured() {
  if (!isSupabaseConfigured || !supabase) {
    const error = new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.",
    );
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const applySession = async (session) => {
    if (!session) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const profile = await authService.getProfile(session.user.id);
      setUser(authService.toAppUser(profile));
    } catch (err) {
      // Profile may be missing if the profile trigger failed; fall back to the
      // auth user metadata instead of dropping the session.
      console.error("Failed to load profile", err);
      setUser({
        id: session.user.id,
        fullName:
          session.user.user_metadata?.full_name ||
          session.user.email?.split("@")[0] ||
          "Player",
        email: session.user.email,
        phone: session.user.user_metadata?.phone || "",
        role: "customer",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return undefined;
    }
    let mounted = true;
    const hydrate = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (mounted) await applySession(session);
      if (mounted) setLoading(false);
    };
    hydrate();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) applySession(session);
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function login(credentials) {
    assertConfigured();
    const nextUser = await authService.signIn(credentials);
    setUser(nextUser);
    setLoading(false);
    return nextUser;
  }

  async function register(details) {
    assertConfigured();
    const result = await authService.signUp(details);
    if (result && !result.requiresEmailConfirmation && result.user) {
      setUser(result.user);
    }
    setLoading(false);
    return result;
  }

  async function logout() {
    assertConfigured();
    await authService.signOut();
    setUser(null);
    setLoading(false);
  }

  async function forgotPassword(email) {
    return authService.requestPasswordReset(email);
  }

  async function updateProfile(updates) {
    assertConfigured();
    const profile = await authService.updateProfile(updates);
    setUser(authService.toAppUser(profile));
    return profile;
  }

  async function updatePassword(newPassword) {
    assertConfigured();
    return authService.updatePassword(newPassword);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        forgotPassword,
        updateProfile,
        updatePassword,
      }}>
      {children}
    </AuthContext.Provider>
  );
}
