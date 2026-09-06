export async function signIn({ email = "" } = {}) {
  const isAdmin = email.toLowerCase() === "admin@rallycourt.ph";
  return {
    id: isAdmin ? "admin-user" : "demo-user",
    fullName: isAdmin ? "Alex Rivera" : "Mia Santos",
    email: isAdmin ? "admin@rallycourt.ph" : email || "mia@example.com",
    phone: isAdmin ? "+63 917 555 0100" : "+63 917 555 0188",
    role: isAdmin ? "admin" : "customer",
  };
}
export async function register(details) {
  return { id: "demo-user", role: "customer", ...details };
}
export async function requestPasswordReset(email) {
  return { email, sent: true };
}
export const authService = { signIn, register, requestPasswordReset };
