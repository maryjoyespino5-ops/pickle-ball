import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="route-loading">Loading your account...</p>;
  return user ? children : <Navigate to="/login" replace />;
}
