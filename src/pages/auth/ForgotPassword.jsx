import { Link } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useAuth } from "../../hooks/useAuth";
export function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err.message || "Could not send the reset link. Try again.");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">ACCOUNT ACCESS</span>
        <h1>
          Reset your
          <br />
          <em>password.</em>
        </h1>
        <p>
          {sent
            ? "Check your inbox for a link to reset your password."
            : "Enter your email and we will send you a secure reset link."}
        </p>
        {!sent && (
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
            {error && <ErrorMessage message={error} />}
            <Button type="submit">
              {submitting ? "Sending..." : "Send reset link"}{" "}
              <span aria-hidden="true">-&gt;</span>
            </Button>
          </form>
        )}
        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
