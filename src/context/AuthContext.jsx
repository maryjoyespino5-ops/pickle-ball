import { useState } from "react";
import { authService } from "../services/authService";
import { AuthContext } from "./AuthContextValue";

const demoUser = {
  id: "demo-user",
  fullName: "Mia Santos",
  email: "mia@example.com",
  phone: "+63 917 555 0188",
  role: "customer",
};
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem("rally-auth-user");
    return storedUser ? JSON.parse(storedUser) : demoUser;
  });
  const [loading, setLoading] = useState(false);
  async function login(credentials) {
    setLoading(true);
    const nextUser = await authService.signIn(credentials);
    setUser(nextUser);
    localStorage.setItem("rally-auth-user", JSON.stringify(nextUser));
    setLoading(false);
    return nextUser;
  }
  async function register(details) {
    setLoading(true);
    const nextUser = await authService.register(details);
    setUser(nextUser);
    localStorage.setItem("rally-auth-user", JSON.stringify(nextUser));
    setLoading(false);
    return nextUser;
  }
  function logout() {
    setUser(null);
    localStorage.removeItem("rally-auth-user");
  }
  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
