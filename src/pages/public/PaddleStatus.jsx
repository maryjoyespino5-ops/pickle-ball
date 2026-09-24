import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { paddleService } from "../../services/paddleService";
import { formatTime12, formatDate } from "../../utils/dateUtils";
import { useNow } from "../../hooks/useNow";

/** "1h 32m 5s" / "32m 5s" / "5s" — padded with leading zeros per unit. */
function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  if (minutes > 0)
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

const STATUS_META = {
  available: { label: "Available", dot: "🟢", tone: "available", headline: "Ready to play" },
  in_use: { label: "Currently In Use", dot: "🔴", tone: "in-use", headline: "Being used right now" },
  reserved: { label: "Reserved", dot: "🟡", tone: "reserved", headline: "Paddle is reserved" },
  disabled: { label: "Deactivated", dot: "⚪", tone: "disabled", headline: "Paddle is deactivated" },
};

export function PaddleStatus() {
  const { token } = useParams();
  const now = useNow(1000);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) {
      setError("No paddle was found for this QR code.");
      setLoading(false);
      return;
    }
    try {
      const row = await paddleService.getPublicPaddleStatus(token);
      setData(row || null);
      setError(row ? "" : "This QR code does not match a registered paddle.");
    } catch (err) {
      setError(err.message || "Could not check this paddle. Try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(() => {
      // Re-check the database every 60s so late booking assignments/cancels show.
      if (document.visibilityState === "visible") load();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <main className="paddle-status-page"><p className="paddle-status-loading" role="status">Checking paddle…</p></main>;

  if (error || !data) {
    return (
      <main className="paddle-status-page">
        <section className="paddle-status-card">
          <img className="paddle-status-mark" src="/favicon.png" alt="Alicayard Pickle Ball logo" />
          <h1>Paddle not found</h1>
          <p>This QR code does not match a registered paddle. Ask the front desk for help.</p>
        </section>
      </main>
    );
  }

  const startMs = data.start_time ? new Date(data.start_time).getTime() : null;
  const endMs = data.end_time ? new Date(data.end_time).getTime() : null;

  // Live status: rental times come from the server, but the countdown ticks on
  // the client so "In Use" automatically flips to "Available" at expiry.
  let status = data.status;
  let countdownLabel = "";
  if (data.is_active && startMs && endMs) {
    if (now >= endMs) {
      status = "available";
    } else if (now >= startMs) {
      status = "in_use";
      countdownLabel = formatRemaining(endMs - now);
    } else {
      status = "reserved";
      countdownLabel = `Starts in ${formatRemaining(startMs - now)}`;
    }
  }

  const meta = STATUS_META[status] || STATUS_META.available;

  return (
    <main className="paddle-status-page">
      <section className="paddle-status-card" aria-live="polite">
        <img className="paddle-status-mark" src="/favicon.png" alt="Alicayard Pickle Ball logo" />
        <span className="admin-kicker">PICKLEBALL PADDLE</span>
        <h1>Paddle #{data.paddle_number}</h1>
        {data.name && <p className="paddle-status-name">{data.name}</p>}

        <div className={`paddle-status-badge ${meta.tone}`}>
          <span aria-hidden="true">{meta.dot}</span>
          <strong>{meta.label}</strong>
        </div>
        <p className="paddle-status-headline">{meta.headline}</p>

        {status === "in_use" && (
          <div className="paddle-status-times">
            <div>
              <small>Reserved by</small>
              <strong>{data.rental_name || "Guest"}</strong>
            </div>
            <div>
              <small>Date</small>
              <strong>{formatDate(data.booking_date)}</strong>
            </div>
            <div>
              <small>Started</small>
              <strong>{formatTime12(new Date(startMs).toTimeString().slice(0, 5))}</strong>
            </div>
            <div>
              <small>Ends</small>
              <strong>{formatTime12(new Date(endMs).toTimeString().slice(0, 5))}</strong>
            </div>
          </div>
        )}
        {status === "reserved" && (
          <div className="paddle-status-times">
            <div>
              <small>Reserved by</small>
              <strong>{data.rental_name || "Guest"}</strong>
            </div>
            <div>
              <small>Date</small>
              <strong>{formatDate(data.booking_date)}</strong>
            </div>
            <div>
              <small>Starts at</small>
              <strong>{formatTime12(new Date(startMs).toTimeString().slice(0, 5))}</strong>
            </div>
            <div>
              <small>Ends at</small>
              <strong>{formatTime12(new Date(endMs).toTimeString().slice(0, 5))}</strong>
            </div>
          </div>
        )}

        {countdownLabel && (
          <div className={`paddle-status-countdown ${status === "in_use" ? "live" : ""}`}>
            <small>{status === "in_use" ? "Remaining time" : "Countdown"}</small>
            <strong>{countdownLabel}</strong>
          </div>
        )}

        {status === "available" && (
          <p className="paddle-status-cta">
            This paddle is ready to use. Enjoy the game! 🎾
          </p>
        )}
        {status === "disabled" && (
          <p className="paddle-status-cta">
            This paddle has been temporarily deactivated by the facility.
          </p>
        )}
      </section>
    </main>
  );
}