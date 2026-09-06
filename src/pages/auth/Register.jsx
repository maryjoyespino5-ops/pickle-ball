import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useAuth } from "../../hooks/useAuth";
export function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [details, setDetails] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const update = (event) =>
    setDetails({ ...details, [event.target.name]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (details.password !== details.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (details.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await register({
        fullName: details.fullName,
        email: details.email,
        phone: details.phone,
        password: details.password,
      });
      if (result?.requiresEmailConfirmation) {
        setConfirmationSent(true);
      } else {
        navigate("/dashboard");
      }
      setSubmitting(false);
    } catch (err) {
      setError(err.message || "Unable to create your account. Try again.");
      setSubmitting(false);
    }
  };
  return (
    <main className="auth-page register-page">
      <div className="auth-panel">
        <span className="eyebrow">JOIN THE CLUB</span>
        <h1>
          Create your
          <br />
          <em>account.</em>
        </h1>
        <p>
          {confirmationSent
            ? "Almost there. Check your inbox and click the link to confirm your email address."
            : "Set up your profile and book your first hour on court."}
        </p>
        {!confirmationSent && (
          <form className="form-card form-grid" onSubmit={submit}>
            <label className="span-two">
              Full name
              <input
                name="fullName"
                value={details.fullName}
                onChange={update}
                required
              />
            </label>
            <label>
              Email address
              <input
                name="email"
                type="email"
                value={details.email}
                onChange={update}
                required
              />
            </label>
            <label>
              Phone number
              <input
                name="phone"
                value={details.phone}
                onChange={update}
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                value={details.password}
                onChange={update}
                required
              />
            </label>
            <label>
              Confirm password
              <input
                name="confirmPassword"
                type="password"
                value={details.confirmPassword}
                onChange={update}
                required
              />
            </label>
            {error && <ErrorMessage message={error} />}
            <Button type="submit">
              {submitting ? "Creating..." : "Create account"}{" "}
              <span aria-hidden="true">-&gt;</span>
            </Button>
          </form>
        )}
        <p className="auth-switch">
          {confirmationSent ? (
            <Link to="/login">Back to sign in</Link>
          ) : (
            <>Already a member? <Link to="/login">Sign in</Link></>
          )}
        </p>
      </div>
    </main>
  );
}
