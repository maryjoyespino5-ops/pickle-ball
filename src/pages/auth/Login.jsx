import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../hooks/useAuth";
export function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("mia@example.com");
  const submit = async (event) => {
    event.preventDefault();
    const user = await login({ email });
    navigate(user.role === "admin" ? "/admin" : "/dashboard");
  };
  return (
    <main className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">WELCOME BACK</span>
        <h1>
          Ready to
          <br />
          <em>play?</em>
        </h1>
        <p>Log in to manage your bookings and get back on court.</p>
        <form className="form-card" onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input type="password" defaultValue="password" required />
          </label>
          <div className="form-meta">
            <label className="check-label">
              <input type="checkbox" /> Remember me
            </label>
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
          <Button type="submit">
            {loading ? "Signing in..." : "Sign in"}{" "}
            <span aria-hidden="true">-&gt;</span>
          </Button>
        </form>
        <p className="auth-switch">
          New to Rally? <Link to="/register">Create an account</Link>
        </p>
      </div>
      <div className="auth-art">
        <span>
          PLAY
          <br />
          <em>ON.</em>
        </span>
      </div>
    </main>
  );
}
