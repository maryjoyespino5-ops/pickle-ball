import { useEffect, useState } from "react";
import { authService } from "../services/authService";
import { useAuth } from "./useAuth";

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    authService
      .getProfile(user.id)
      .then((row) => {
        if (active) setProfile(row ? authService.toAppUser(row) : user);
      })
      .catch((err) => {
        if (active) setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);
  return { profile, loading, error };
}
