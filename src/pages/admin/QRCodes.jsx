import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../components/common/Modal";
import { QrCode } from "../../components/qr/QrCode";
import { useAutoDismiss } from "../../hooks/useAutoDismiss";
import { useNow } from "../../hooks/useNow";
import { bookingService } from "../../services/bookingService";
import { paddleService } from "../../services/paddleService";
import { formatTime12, todayISO } from "../../utils/dateUtils";

/** Paddle #01, #02, … for display. */
function paddleLabel(paddle) {
  return `Paddle #${String(paddle.paddleNumber).trim().padStart(2, "0")}`;
}

/** "1h 32m" / "32m" / "45s" style remaining time. */
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatClock(dateMs) {
  return formatTime12(new Date(dateMs).toTimeString().slice(0, 5));
}

/** Recompute a paddle's live status from its linked booking + current clock. */
function liveStatus(paddle, now) {
  if (!paddle.isActive) return "disabled";
  if (!paddle.booking) return "available";
  if (now < paddle.booking.startMs) return "reserved";
  if (now < paddle.booking.endMs) return "in_use";
  return "available";
}

const STATUS_META = {
  available: { label: "Available", cls: "status-active" },
  in_use: { label: "In Use", cls: "status-pending" },
  reserved: { label: "Reserved", cls: "status-upcoming" },
  disabled: { label: "Disabled", cls: "status-inactive" },
};

function PaddleStatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.available;
  return <span className={`status ${meta.cls}`}>{meta.label}</span>;
}
export function QRCodes() {
  const [paddles, setPaddles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkBookings, setLinkBookings] = useState([]);
  const [printOpen, setPrintOpen] = useState(false);
  const [printTargets, setPrintTargets] = useState([]);
  const canvasMap = useRef({});
  const now = useNow(1000);
  useAutoDismiss(feedback, () => setFeedback(""));

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      const rows = await paddleService.getPaddles();
      setPaddles(rows);
    } catch (err) {
      setLoadError(err.message || "Could not load paddles. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectAll = (checked) => {
    setSelectedIds(
      new Set(
        checked ? paddles.filter((p) => p.isActive).map((p) => p.id) : [],
      ),
    );
  };
  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const summary = useMemo(() => {
    const inUse = paddles.filter((p) => liveStatus(p, now) === "in_use").length;
    const reserved = paddles.filter((p) => liveStatus(p, now) === "reserved").length;
    return { total: paddles.length, active: paddles.filter((p) => p.isActive).length, inUse, reserved };
  }, [paddles, now]);

  const runAction = async (fn, successText) => {
    setActionError("");
    try {
      await fn();
      await refresh();
      setFeedback(successText);
      return { ok: true };
    } catch (err) {
      const message = err.message || "Action failed. Try again.";
      setActionError(message);
      return { ok: false, message };
    }
  };

  const handleSavePaddle = async (values, target) => {
    setActionError("");
    try {
      if (target) {
        await paddleService.updatePaddle(target.id, {
          paddleNumber: values.paddleNumber,
          name: values.name,
          isActive: values.isActive,
        });
      } else {
        await paddleService.createPaddle(values);
      }
      await refresh();
      setFeedback(target ? "Paddle updated." : "Paddle added.");
      setEditTarget(null);
      setAddOpen(false);
    } catch (err) {
      const message = err.message || "Could not save this paddle.";
      setActionError(message);
      throw err;
    }
  };

  const handleToggleActive = async (paddle) => {
    await runAction(async () => {
      await paddleService.setPaddleActive(paddle.id, !paddle.isActive);
      canvasMap.current[paddle.id] = null;
    }, paddle.isActive ? "Paddle deactivated." : "Paddle activated.");
  };

  const handleRegenerateQr = async (paddle) => {
    await runAction(async () => {
      await paddleService.regenerateQrToken(paddle.id);
      canvasMap.current[paddle.id] = null;
    }, "New QR code generated — reprint the paddle sticker.");
  };

  const handleDelete = async () => {
    const { ok } = await runAction(
      async () => paddleService.deletePaddle(deleteTarget.id),
      "Paddle deleted.",
    );
    if (ok) setDeleteTarget(null);
  };

  const openLink = async (paddle) => {
    setLinkTarget(paddle);
    setActionError("");
    try {
      const rows = await bookingService.getAllBookings({ date: todayISO() });
      setLinkBookings(
        rows.filter((b) => ["upcoming", "confirmed"].includes(b.status)),
      );
    } catch (err) {
      setActionError(err.message || "Could not load today's bookings.");
    }
  };

  const handleLink = async (booking) => {
    const { ok } = await runAction(async () => {
      await bookingService.assignPaddleToBooking(linkTarget.id, booking.id);
    }, `Paddle linked to booking ${booking.id}.`);
    if (ok) {
      setLinkTarget(null);
      setLinkBookings([]);
    }
  };

  const handleUnlink = async (booking) => {
    const { ok } = await runAction(async () => {
      await bookingService.unassignPaddleFromBooking(booking.id);
    }, `Paddle released from booking ${booking.id}.`);
    if (ok) {
      setLinkTarget(null);
      setLinkBookings([]);
    }
  };

  const handleDownloadQr = (paddle) => {
    const canvas = canvasMap.current[paddle.id];
    if (!canvas) {
      setFeedback("QR code is still generating — try again in a second.");
      return;
    }
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${paddle.qrToken || `${paddleLabel(paddle).toLowerCase().replace(/\s+/g, "-")}`}.png`;
    link.click();
    setFeedback(`QR code for ${paddleLabel(paddle)} downloaded.`);
  };

  const openPrint = () => {
    const targets = selectedIds.size
      ? paddles.filter((p) => selectedIds.has(p.id))
      : paddles;
    if (targets.length === 0) {
      setFeedback("Add a paddle first, then print its QR code.");
      return;
    }
    setPrintTargets(targets);
    setPrintOpen(true);
  };

  const nextPaddleNumber = useMemo(() => {
    const max = paddles.reduce((top, p) => {
      const n = Number(p.paddleNumber);
      return Number.isFinite(n) && n > top ? n : top;
    }, 0);
    return String(max + 1);
  }, [paddles]);
return (
    <div className="admin-page qr-codes-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">PADDLE EQUIPMENT</span>
          <h2>QR Codes</h2>
          <p>
            Manage paddle QR stickers and link them to today's existing
            bookings. Scanning a QR opens a live public status page.
          </p>
        </div>
        <div className="qr-heading-actions">
          <button className="button outline" onClick={openPrint}>
            Print QR Codes
          </button>
          <button className="button" onClick={() => setAddOpen(true)}>
            Add Paddle
          </button>
        </div>
      </div>

      <div className="qr-stat-row">
        <div className="qr-stat">
          <strong>{summary.total}</strong>
          <span>Total paddles</span>
        </div>
        <div className="qr-stat">
          <strong>{summary.active}</strong>
          <span>Active</span>
        </div>
        <div className="qr-stat">
          <strong>{summary.inUse}</strong>
          <span>In use now</span>
        </div>
        <div className="qr-stat">
          <strong>{summary.reserved}</strong>
          <span>Reserved today</span>
        </div>
      </div>

      {feedback && (
        <div className="success-message admin-feedback">
          {feedback}
          <button onClick={() => setFeedback("")}>×</button>
        </div>
      )}
      {actionError && (
        <div className="error-message admin-feedback">{actionError}</div>
      )}
      {loadError && <ErrorMessage message={loadError} />}

      {loading ? (
        <div className="empty-panel">Loading paddles…</div>
      ) : paddles.length === 0 ? (
        <div className="empty-panel">
          No paddles registered yet. Click <strong>Add Paddle</strong> to
          create your first paddle QR code.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="admin-table paddle-table">
            <thead>
              <tr>
                <th className="qr-check-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all paddles for printing"
                    checked={
                      paddles.length > 0 &&
                      paddles.every((p) => selectedIds.has(p.id))
                    }
                    onChange={(event) => selectAll(event.target.checked)}
                  />
                </th>
                <th>Paddle</th>
                <th>QR code</th>
                <th>Status</th>
                <th>Renter / court</th>
                <th>Rental window</th>
                <th>Remaining</th>
                <th className="table-action-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paddles.map((paddle) => {
                const status = liveStatus(paddle, now);
                const booking = paddle.booking;
                const remaining =
                  status === "in_use"
                    ? booking.endMs - now
                    : status === "reserved"
                      ? booking.startMs - now
                      : 0;
                return (
                  <tr key={paddle.id}>
<td className="qr-check-cell" data-label="Print">
                      <input
                        type="checkbox"
                        aria-label={`Select ${paddleLabel(paddle)} for printing`}
                        checked={selectedIds.has(paddle.id)}
                        onChange={() => toggleSelected(paddle.id)}
                      />
                    </td>
                    <td data-label="Paddle">
                      <strong>
                        {paddleLabel(paddle)}
                        {paddle.isActive ? "" : " · inactive"}
                      </strong>
                      {paddle.name && <small>{paddle.name}</small>}
                    </td>
                    <td data-label="QR code">
                      <div className="qr-preview-cell">
                        <QrCode
                          value={`${window.location.origin}/paddle/${paddle.qrToken}`}
                          size={96}
                          className="qr-preview"
                          canvasStore={canvasMap}
                          storeKey={paddle.id}
                        />
                        <small>{paddle.qrToken}</small>
                      </div>
                    </td>
                    <td data-label="Status">
                      <PaddleStatusBadge status={status} />
                    </td>
                    <td data-label="Renter / court">
                      {booking ? (
                        <>
                          <strong>{booking.customer}</strong>
                          <small>{booking.courtName}</small>
                        </>
                      ) : (
                        <small>—</small>
                      )}
                    </td>
                    <td data-label="Rental window">
                      {booking ? (
                        <>
                          <strong>
                            {formatClock(booking.startMs)} –{" "}
                            {formatClock(booking.endMs)}
                          </strong>
                          <small>{booking.date}</small>
                        </>
                      ) : (
                        <small>—</small>
                      )}
                    </td>
                    <td data-label="Remaining">
                      {status === "in_use" || status === "reserved" ? (
                        <strong className="qr-remaining">
                          {formatDuration(remaining)}
                        </strong>
                      ) : (
                        <small>—</small>
                      )}
                    </td>
                    <td className="table-action-cell" data-label="Actions">
                      <div className="row-actions qr-row-actions">
                        <button onClick={() => openLink(paddle)}>
                          {booking ? "Unlink" : "Link booking"}
                        </button>
                        <button onClick={() => setEditTarget({ ...paddle })}>
                          Edit
                        </button>
                        <button onClick={() => handleRegenerateQr(paddle)}>
                          Generate QR
                        </button>
                        <button onClick={() => handleDownloadQr(paddle)}>
                          Download
                        </button>
                        <button
                          onClick={() => {
                            setPrintTargets([paddle]);
                            setPrintOpen(true);
                          }}>
                          Print
                        </button>
                        <button onClick={() => handleToggleActive(paddle)}>
                          {paddle.isActive ? "Deactivate" : "Activate"}
                        </button>
                        <button onClick={() => setDeleteTarget(paddle)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
);
              })}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && (
        <Modal title="Add paddle" onClose={() => setAddOpen(false)}>
          <AddPaddleForm
            defaultNumber={nextPaddleNumber}
            onSubmit={async (values) => await handleSavePaddle(values, null)}
          />
        </Modal>
      )}

      {editTarget && (
        <Modal
          title={`Edit ${paddleLabel(editTarget)}`}
          onClose={() => setEditTarget(null)}>
          <AddPaddleForm
            defaultNumber={editTarget.paddleNumber}
            defaultName={editTarget.name}
            defaultActive={editTarget.isActive}
            submitLabel="Save changes"
            onSubmit={async (values) =>
              await handleSavePaddle(values, editTarget)
            }
          />
          <button
            className="button outline qr-regenerate-row"
            onClick={() => handleRegenerateQr(editTarget)}>
            Generate new QR code
          </button>
        </Modal>
      )}

      {deleteTarget && (
        <Modal title="Delete paddle?" onClose={() => setDeleteTarget(null)}>
          <div className="confirm-dialog">
            <p>
              Delete <strong>{paddleLabel(deleteTarget)}</strong>? Its QR code
              will stop working immediately. Linked bookings are kept and
              simply release the paddle.
            </p>
            {actionError && (
              <span className="error-message">{actionError}</span>
            )}
            <div>
              <button className="button danger" onClick={handleDelete}>
                Delete paddle
              </button>
              <button
                className="button outline"
                onClick={() => setDeleteTarget(null)}>
                Keep paddle
              </button>
            </div>
          </div>
        </Modal>
      )}
{linkTarget && (
        <Modal
          title={`${paddleLabel(linkTarget)} — link booking`}
          onClose={() => {
            setLinkTarget(null);
            setLinkBookings([]);
          }}>
          <p className="qr-link-help">
            Attach the paddle to one of today's bookings. The paddle status is
            derived from that booking's existing start time and duration.
          </p>
          {actionError && (
            <span className="error-message qr-link-error">{actionError}</span>
          )}
          {linkBookings.length === 0 ? (
            <p className="empty-panel">
              No upcoming or confirmed bookings today.
            </p>
          ) : (
            <div className="qr-link-list">
              {linkBookings.map((booking) => {
                const assigned = booking.paddleId === linkTarget.id;
                const taken = Boolean(booking.paddleId) && !assigned;
                const startMs = new Date(
                  `${booking.date}T${booking.time}:00`,
                ).getTime();
                const endMs = startMs + booking.duration * 3600 * 1000;
                return (
                  <div className="qr-link-row" key={booking.id}>
                    <div>
                      <strong>{booking.id}</strong>
                      <small>
                        {booking.courtName} · {formatClock(startMs)} –{" "}
                        {formatClock(endMs)} · {booking.customer}
                        {taken && ` · ${booking.paddleNumber}`}
                      </small>
                    </div>
                    {assigned ? (
                      <button
                        className="text-button"
                        onClick={() => handleUnlink(booking)}>
                        Unlink
                      </button>
                    ) : (
                      <button
                        className="button"
                        disabled={taken}
                        type="button"
                        onClick={() => handleLink(booking)}>
                        {taken ? "Assigned" : "Use this paddle"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {printOpen && (
        <Modal title="Print QR codes" onClose={() => setPrintOpen(false)}>
          <p className="qr-link-help">
            Ready to print {printTargets.length} QR card
            {printTargets.length === 1 ? "" : "s"}. Cut each card and attach it
            to the matching paddle.
          </p>
          <div className="qr-print-preview">
            {printTargets.map((paddle) => (
              <QrCode
                key={paddle.id}
                value={`${window.location.origin}/paddle/${paddle.qrToken}`}
                size={120}
                className="qr-preview"
              />
            ))}
          </div>
          <button className="button" onClick={() => window.print()}>
            Print {printTargets.length === 1 ? "card" : "cards"}
          </button>
        </Modal>
      )}

      {/* Hidden print sheet — only this is visible when printing. */}
      <div className="qr-print-sheet">
        {printTargets.map((paddle) => (
          <div className="qr-print-card" key={paddle.id}>
            <p className="qr-print-kicker">PICKLEBALL PADDLE</p>
            <strong className="qr-print-title">
              {paddleLabel(paddle)}
            </strong>
            <QrCode
              value={`${window.location.origin}/paddle/${paddle.qrToken}`}
              size={300}
              className="qr-print-code"
            />
            <span className="qr-print-caption">
              Scan to check paddle status
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddPaddleForm({
  defaultNumber = "",
  defaultName = "",
  defaultActive = true,
  submitLabel = "Add paddle",
  onSubmit,
}) {
  const [paddleNumber, setPaddleNumber] = useState(defaultNumber);
  const [name, setName] = useState(defaultName);
  const [isActive, setIsActive] = useState(defaultActive);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!String(paddleNumber || "").trim()) {
      setError("Enter a paddle number.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({
        paddleNumber: paddleNumber.trim(),
        name: name.trim(),
        isActive,
      });
    } catch (err) {
      setError(err.message || "Could not save this paddle.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="court-edit-form" onSubmit={submit}>
      <label>
        Paddle number
        <input
          required
          value={paddleNumber}
          onChange={(event) => setPaddleNumber(event.target.value)}
          placeholder="e.g. 1 or 01"
        />
      </label>
      <label>
        Name / label (optional)
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Red handle paddle"
        />
      </label>
      <label className="toggle-row">
        Active (visible &amp; scannable){" "}
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => setIsActive(event.target.checked)}
        />
      </label>
      {error && <span className="error-message">{error}</span>}
      <button className="button" type="submit" disabled={saving}>
        {saving ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}