import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CourtStatus } from "../../components/courts/CourtStatus";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { Modal } from "../../components/common/Modal";
import { courtService } from "../../services/courtService";
import { formatCurrency } from "../../utils/currencyUtils";

export function Courts() {
  const [courts, setCourts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const navigate = useNavigate();
  const load = () => {
    setLoadError("");
    setLoading(true);
    courtService
      .getManagedCourts()
      .then(setCourts)
      .catch((err) =>
        setLoadError(err.message || "Could not load courts. Try again."),
      )
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, []);
  const update = async (changes) => {
    if (!selected) return;
    if (!String(selected.name || "").trim()) {
      setSaveError("Court name is required.");
      return;
    }
    if (!(Number(selected.price) >= 0)) {
      setSaveError("Price per hour must be zero or more.");
      return;
    }
    setSaveError("");
    setSaving(true);
    try {
      const next = await courtService.updateCourt(selected.id, {
        enabled: selected.enabled,
        maintenance: selected.maintenance,
        name: selected.name,
        description: selected.description,
        price: selected.price,
        image: selected.image,
      });
      setCourts(next);
      setSelected(null);
    } catch (err) {
      setSaveError(err.message || "Could not save this court. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">FACILITY MANAGEMENT</span>
          <h2>Courts</h2>
          <p>Keep your two courts available, accurate, and ready for play.</p>
        </div>
        <span className="result-count">{courts.length} courts total</span>
      </div>
      {loadError && (
        <div className="admin-load-row">
          <ErrorMessage message={loadError} />
          <button className="button outline" type="button" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {loading ? (
        <p className="loading-state">Loading courts...</p>
      ) : (
        <div className="admin-court-grid">
          {courts.map((court) => (
            <article className="managed-court-card" key={court.id}>
              <div className={`managed-court-art ${court.accent}`}>
                <span>{court.name.replace("Court ", "0")}</span>
              </div>
              <div className="managed-court-body">
                <div className="managed-court-heading">
                  <div>
                    <span className="admin-kicker">PICKLEBALL COURT</span>
                    <h3>{court.name}</h3>
                  </div>
                  <CourtStatus
                    status={court.maintenance ? "maintenance" : court.status}
                  />
                </div>
                <p>{court.description}</p>
                <div className="managed-court-meta">
                  <strong>
                    {formatCurrency(court.price)}
                    <small>/ hour</small>
                  </strong>
                  <span>
                    {court.enabled
                      ? "Available for booking"
                      : "Temporarily disabled"}
                  </span>
                </div>
                <div className="court-card-actions">
                  <button
                    className="button outline"
                    onClick={() => {
                      setSaveError("");
                      setSelected({ ...court });
                    }}>
                    Edit court
                  </button>
                  <button
                    className="text-button"
                    onClick={() => navigate(`/admin/calendar?court=${court.id}`)}>
                    View availability
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {selected && (
        <Modal
          title={`Edit ${selected.name}`}
          onClose={() => setSelected(null)}>
          <div className="court-edit-form">
            <label>
              Court name
              <input
                value={selected.name}
                onChange={(event) =>
                  setSelected({ ...selected, name: event.target.value })
                }
              />
            </label>
            <label>
              Description
              <textarea
                rows="3"
                value={selected.description}
                onChange={(event) =>
                  setSelected({ ...selected, description: event.target.value })
                }
              />
            </label>
            <label>
              Price per hour
              <input
                type="number"
                min="0"
                value={selected.price}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    price: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Image reference
              <input
                value={selected.image}
                onChange={(event) =>
                  setSelected({ ...selected, image: event.target.value })
                }
              />
            </label>
            <label className="toggle-row">
              Available for booking{" "}
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(event) =>
                  setSelected({ ...selected, enabled: event.target.checked })
                }
              />
            </label>
            <label className="toggle-row">
              Maintenance mode{" "}
              <input
                type="checkbox"
                checked={selected.maintenance}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    maintenance: event.target.checked,
                  })
                }
              />
            </label>
            {saveError && <ErrorMessage message={saveError} />}
            <button
              className="button"
              disabled={saving}
              onClick={() =>
                update({
                  enabled: selected.enabled,
                  maintenance: selected.maintenance,
                  name: selected.name,
                  description: selected.description,
                  price: selected.price,
                  image: selected.image,
                })
              }>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
