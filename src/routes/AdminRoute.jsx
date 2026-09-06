import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return <p className="route-loading">Loading admin workspace...</p>;
  if (!user) return <Navigate to="/login" replace />;
  return user.role === "admin" ? (
    children
  ) : (
    <Navigate to="/dashboard" replace />
  );
}
