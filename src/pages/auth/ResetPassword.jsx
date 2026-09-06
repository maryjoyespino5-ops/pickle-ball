import { Link } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useAuth } from "../../hooks/useAuth";

/**
 * Landing page for the Supabase password-recovery email link.
 * Supabase has already created a recovery session before this page renders,
 * so calling updatePassword() sets the new password for the current user.
 */
export function ResetPassword() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(
        err.message ||
          "Unable to update your password. The link may be invalid or expired.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">ACCOUNT ACCESS</span>
        <h1>
          Choose a new
          <br />
          <em>password.</em>
        </h1>
        <p>
          {done
            ? "Your password has been updated. You can now sign in with it."
            : "Enter a new password for your account."}
        </p>
        {!done && (
          <form className="form-card" onSubmit={submit}>
            <label>
              New password
              <input
                type="password"
                value={password}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
              />
            </label>
            {error && <ErrorMessage message={error} />}
            <Button type="submit">
              {submitting ? "Updating..." : "Update password"}{" "}
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