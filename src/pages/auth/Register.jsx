import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "../../components/common/Button";
import { useAuth } from "../../hooks/useAuth";
export function Register() {
  const { register, loading } = useAuth();
  const navigate = useNavigate();
  const [details, setDetails] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const update = (event) =>
    setDetails({ ...details, [event.target.name]: event.target.value });
  const submit = async (event) => {
    event.preventDefault();
    await register(details);
    navigate("/dashboard");
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
        <p>Set up your profile and book your first hour on court.</p>
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
          <Button type="submit">
            {loading ? "Creating..." : "Create account"}{" "}
            <span aria-hidden="true">-&gt;</span>
          </Button>
        </form>
        <p className="auth-switch">
          Already a member? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
