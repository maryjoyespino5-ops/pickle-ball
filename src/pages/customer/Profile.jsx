import { useState } from "react";
import { Button } from "../../components/common/Button";
import { Modal } from "../../components/common/Modal";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useAuth } from "../../hooks/useAuth";

function initials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function Profile() {
  const { user, updateProfile, updatePassword } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [profile, setProfile] = useState({
    fullName: user?.fullName || "",
    email: user?.email || "",
    phone: user?.phone || "",
  });
  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const update = (key, value) => {
    setProfile((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const save = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      await updateProfile({ fullName: profile.fullName, phone: profile.phone });
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(err.message || "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };
  const openPassword = () => {
    setPasswordError("");
    setPasswordNotice("");
    setPasswordOpen(true);
  };
  const submitPassword = async (event) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordNotice("");
    if (password.next !== password.confirm) {
      setPasswordError("New passwords do not match.");
      return;
    }
    if (password.next.length < 8) {
      setPasswordError("New password must be at least 8 characters long.");
      return;
    }
    try {
      await updatePassword(password.next);
      setPassword({ current: "", next: "", confirm: "" });
      setPasswordNotice("Password updated. Use it the next time you sign in.");
    } catch (err) {
      setPasswordError(err.message || "Unable to update your password.");
    }
  };
  return (
    <main className="dashboard-page profile-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR ACCOUNT</span>
          <h1>Profile</h1>
          <p>Keep your contact details up to date.</p>
        </div>
        <Button
          variant="outline"
          onClick={(event) => {
            if (editing) {
              save(event);
            } else {
              setEditing(true);
            }
          }}>
          {editing ? (saving ? "Saving..." : "Save changes") : "Edit profile"}
        </Button>
      </div>
      <section className="profile-card">
        <div className="avatar">{initials(user?.fullName)}</div>
        <div className="profile-fields">
          <label>
            Full name
            <input
              disabled={!editing}
              value={profile.fullName}
              onChange={(event) => update("fullName", event.target.value)}
            />
          </label>
          <label>
            Email address
            <input
              disabled={!editing}
              value={profile.email}
              onChange={(event) => update("email", event.target.value)}
              type="email"
            />
          </label>
          <label>
            Phone number
            <input
              disabled={!editing}
              value={profile.phone}
              onChange={(event) => update("phone", event.target.value)}
            />
          </label>
        </div>
      </section>
      {error && <ErrorMessage message={error} />}
      <section className="password-row">
        <div>
          <span className="eyebrow">SECURITY</span>
          <h2>Password</h2>
          <p>Change your password regularly to keep your account secure.</p>
        </div>
        <button
          className="button outline"
          onClick={openPassword}>
          Change password
        </button>
      </section>
      {saved && (
        <div className="success-message profile-feedback">
          Profile changes saved.
        </div>
      )}
      {passwordOpen && (
        <Modal title="Change password" onClose={() => setPasswordOpen(false)}>
          <form className="form-card modal-form" onSubmit={submitPassword}>
            <label>
              New password
              <input
                type="password"
                minLength="8"
                value={password.next}
                onChange={(event) =>
                  setPassword({ ...password, next: event.target.value })
                }
                required
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                minLength="8"
                value={password.confirm}
                onChange={(event) =>
                  setPassword({ ...password, confirm: event.target.value })
                }
                required
              />
            </label>
            {passwordNotice && (
              <div className="success-message">{passwordNotice}</div>
            )}
            {passwordError && <ErrorMessage message={passwordError} />}
            <button className="button" type="submit">
              Update password
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
