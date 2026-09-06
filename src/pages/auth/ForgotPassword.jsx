import { Link } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/common/Button";
import { authService } from "../../services/authService";
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    await authService.requestPasswordReset(email);
    setSent(true);
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
            <Button type="submit">
              Send reset link <span aria-hidden="true">-&gt;</span>
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
