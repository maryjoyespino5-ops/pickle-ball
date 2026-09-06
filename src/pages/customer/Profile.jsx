import { useState } from "react";
import { Button } from "../../components/common/Button";
import { Modal } from "../../components/common/Modal";
import { useAuth } from "../../hooks/useAuth";
export function Profile() {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [profile, setProfile] = useState({ fullName: user?.fullName || "", email: user?.email || "", phone: user?.phone || "" });
  const update = (key, value) => { setProfile((current) => ({ ...current, [key]: value })); setSaved(false); };
  return (
    <main className="dashboard-page profile-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR ACCOUNT</span>
          <h1>Profile</h1>
          <p>Keep your contact details up to date.</p>
        </div>
        <Button variant="outline" onClick={() => { setEditing(!editing); setSaved(!editing); }}>
          {editing ? "Save changes" : "Edit profile"}
        </Button>
      </div>
      <section className="profile-card">
        <div className="avatar">MS</div>
        <div className="profile-fields">
          <label>
            Full name
            <input disabled={!editing} value={profile.fullName} onChange={(event) => update("fullName", event.target.value)} />
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
            <input disabled={!editing} value={profile.phone} onChange={(event) => update("phone", event.target.value)} />
          </label>
        </div>
      </section>
      <section className="password-row">
        <div>
          <span className="eyebrow">SECURITY</span>
          <h2>Password</h2>
          <p>Change your password regularly to keep your account secure.</p>
        </div>
        <button className="button outline" onClick={() => setPasswordOpen(true)}>Change password</button>
      </section>
      {saved && <div className="success-message profile-feedback">Profile changes saved.</div>}
      {passwordOpen && <Modal title="Change password" onClose={() => setPasswordOpen(false)}><form className="form-card modal-form" onSubmit={(event) => { event.preventDefault(); setPasswordOpen(false); setSaved(true); }}><label>Current password<input type="password" required /></label><label>New password<input type="password" minLength="8" required /></label><label>Confirm password<input type="password" minLength="8" required /></label><button className="button" type="submit">Update password</button></form></Modal>}
    </main>
  );
}
