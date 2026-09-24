import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Loading } from "../components/common/Loading";

export function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return <Loading label="Loading admin workspace…" />;
  if (!user) return <Navigate to="/login" replace />;
  return user.role === "admin" ? (
    children
  ) : (
    <Navigate to="/dashboard" replace />
  );
}
