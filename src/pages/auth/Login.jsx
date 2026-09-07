import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useAuth } from "../../hooks/useAuth";
export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await login({ email, password });
      navigate(user?.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(
        err.message || "Unable to sign in. Check your credentials and try again.",
      );
      setSubmitting(false);
    }
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
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <ErrorMessage message={error} />}
          <div className="form-meta">
            <label className="check-label">
              <input type="checkbox" /> Remember me
            </label>
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
          <Button type="submit">
            {submitting ? "Signing in..." : "Sign in"}{" "}
            <span aria-hidden="true">-&gt;</span>
          </Button>
        </form>
        <p className="auth-switch">
          New to Alicayard Pickle Ball? <Link to="/register">Create an account</Link>
        </p>
      </div>
      <div className="auth-art">
        <video
          className="auth-art-video"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden="true"
        >
          <source src="/vid1.mp4" type="video/mp4" />
        </video>
        <span>
          PLAY
          <br />
          <em>ON.</em>
        </span>
      </div>
    </main>
  );
}
