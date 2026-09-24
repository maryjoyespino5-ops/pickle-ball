import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { Loading } from "../components/common/Loading";
export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Loading your account…" />;
  return user ? children : <Navigate to="/login" replace />;
}
