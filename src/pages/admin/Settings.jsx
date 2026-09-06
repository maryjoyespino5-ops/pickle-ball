import { useEffect, useState } from "react";
import { Button } from "../../components/common/Button";
import { settingsService } from "../../services/settingsService";
import { authService } from "../../services/authService";
import { useAuth } from "../../hooks/useAuth";

const emptySettings = {
  facilityName: "",
  address: "",
  contact: "",
  facilityEmail: "",
  opening: "07:00",
  closing: "22:00",
  defaultDuration: "1",
  maxDuration: "2",
};

export function Settings() {
  const { user } = useAuth();
  const [values, setValues] = useState({
    ...emptySettings,
    adminName: user?.fullName || "",
    adminEmail: user?.email || "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    settingsService
      .getFacilitySettings()
      .then((settings) => {
        if (settings)
          setValues((current) => ({ ...current, ...settings }));
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  const update = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setError("");
  };
  const save = async (event) => {
    event.preventDefault();
    if (
      !values.facilityName ||
      !values.address ||
      !values.facilityEmail ||
      !values.adminName ||
      !values.adminEmail
    ) {
      setError("Complete all required fields before saving.");
      return;
    }
    if (values.newPassword && values.newPassword !== values.confirmPassword) {
      setError("New password and confirmation must match.");
      return;
    }
    try {
      await settingsService.updateFacilitySettings(values);
      if (values.adminName !== user.fullName) {
        await authService.updateProfile({
          fullName: values.adminName,
          phone: user.phone || "",
        });
      }
      if (values.newPassword) {
        await authService.updatePassword(values.newPassword);
        update("newPassword", "");
        update("confirmPassword", "");
        update("currentPassword", "");
      }
      setSaved(true);
    } catch (saveError) {
      setError(saveError.message);
    }
  };
  const cancel = () => {
    setError("");
    setSaved(false);
    settingsService
      .getFacilitySettings()
      .then((settings) =>
        setValues((current) => ({
          ...current,
          ...(settings || {}),
          adminName: user?.fullName || current.adminName,
          adminEmail: user?.email || current.adminEmail,
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        })),
      );
  };
  return (
    <form className="admin-page settings-page" onSubmit={save}>
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">WORKSPACE CONFIGURATION</span>
          <h2>Settings</h2>
          <p>Keep the facility details and booking rules accurate.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <span className="admin-kicker">FACILITY INFORMATION</span>
          <h3>Where players find you</h3>
          <label>
            Facility name
            <input
              required
              value={values.facilityName}
              onChange={(event) => update("facilityName", event.target.value)}
            />
          </label>
          <label>
            Address
            <input
              required
              value={values.address}
              onChange={(event) => update("address", event.target.value)}
            />
          </label>
          <label>
            Contact number
            <input
              value={values.contact}
              onChange={(event) => update("contact", event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={values.facilityEmail}
              onChange={(event) => update("facilityEmail", event.target.value)}
            />
          </label>
        </section>
        <section className="settings-card">
          <span className="admin-kicker">BOOKING SETTINGS</span>
          <h3>How booking works</h3>
          <label>
            Opening time
            <input
              type="time"
              value={values.opening}
              onChange={(event) => update("opening", event.target.value)}
            />
          </label>
          <label>
            Closing time
            <input
              type="time"
              value={values.closing}
              onChange={(event) => update("closing", event.target.value)}
            />
          </label>
          <label>
            Default booking duration
            <select
              value={values.defaultDuration}
              onChange={(event) =>
                update("defaultDuration", event.target.value)
              }>
              <option value="1">1 hour</option>
              <option value="2">2 hours</option>
            </select>
          </label>
          <label>
            Maximum booking duration
            <select
              value={values.maxDuration}
              onChange={(event) => update("maxDuration", event.target.value)}>
              <option value="1">1 hour</option>
              <option value="2">2 hours</option>
            </select>
          </label>
        </section>
        <section className="settings-card">
          <span className="admin-kicker">ADMIN PROFILE</span>
          <h3>Account details</h3>
          <label>
            Admin name
            <input
              required
              value={values.adminName}
              onChange={(event) => update("adminName", event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={values.adminEmail}
              onChange={(event) => update("adminEmail", event.target.value)}
            />
          </label>
        </section>
        <section className="settings-card">
          <span className="admin-kicker">PASSWORD</span>
          <h3>Change password</h3>
          <label>
            Current password
            <input
              type="password"
              value={values.currentPassword}
              onChange={(event) =>
                update("currentPassword", event.target.value)
              }
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={values.newPassword}
              onChange={(event) => update("newPassword", event.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={values.confirmPassword}
              onChange={(event) =>
                update("confirmPassword", event.target.value)
              }
            />
          </label>
        </section>
      </div>
      <div className="settings-save">
        {loading && <span className="success-message">Loading settings...</span>}
        {error && <span className="error-message">{error}</span>}
        {saved && <span className="success-message">Settings saved.</span>}
        <button className="button outline" type="button" onClick={cancel}>
          Cancel
        </button>
        <Button type="submit">Save settings</Button>
      </div>
    </form>
  );
}
