import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { subscriptionService } from "../../services/subscriptionService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatDate } from "../../utils/dateUtils";

const RENEWAL_STEPS = [
  "Click Renew for ₱999 — you are taken to PayMongo's secure checkout (GCash, card, or bank).",
  "Complete the ₱999 payment. Keep the PayMongo receipt for your records.",
  "PayMongo notifies this app automatically once the payment is verified — no manual recording needed.",
  "Come back here and press Re-check license. It flips to Active the moment the payment is confirmed.",
];

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(value)} ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function Subscription() {
  const [license, setLicense] = useState(null);
  const [payments, setPayments] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const [status, history, log] = await Promise.all([
        subscriptionService.refreshSubscriptionStatus().catch(() =>
          subscriptionService.getSubscriptionStatus(),
        ),
        subscriptionService.getSubscriptionPayments(),
        subscriptionService.getSubscriptionEvents(),
      ]);
      setLicense(status);
      setPayments(history);
      setEvents(log);
    } catch (err) {
      setError(err?.message || "Could not load the subscription. Try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const recheck = async () => {
    setChecking(true);
    setNotice("");
    setError("");
    try {
      const status = await subscriptionService.refreshSubscriptionStatus();
      setLicense(status);
      setNotice(
        status.isActive
          ? "License is active. Booking management is unlocked."
          : "License is still expired. Complete a renewal payment, then check again.",
      );
    } catch (err) {
      setError(err?.message || "Could not re-check the license. Try again.");
    } finally {
      setChecking(false);
    }
  };

  const expired = license && !license.isActive;
  const monthlyFee = license?.monthlyFee ?? subscriptionService.SUBSCRIPTION_FEE;

  /**
   * Open the PayMongo Payment Link in a new tab. We deliberately do NOT mark
   * the license active here — only the verified PayMongo webhook renews it, so
   * a frontend click can never unlock anything. The user returns and presses
   * "Re-check license".
   */
  const renewNow = () => {
    if (!subscriptionService.hasPaymongoLink()) {
      setError(
        "The PayMongo renewal link is not configured. Contact your software provider.",
      );
      return;
    }
    window.open(
      subscriptionService.PAYMONO_PAYMENT_LINK,
      "_blank",
      "noopener,noreferrer",
    );
    setNotice(
      "PayMongo opened in a new tab. Once your ₱999 payment is verified, press Re-check license.",
    );
  };

  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">SOFTWARE LICENSE</span>
          <h2>Subscription</h2>
          <p>Monthly license for this booking system — {formatCurrency(monthlyFee)} every 30 days.</p>
        </div>
        <button className="button outline" type="button" onClick={recheck} disabled={checking || loading}>
          {checking ? "Checking..." : "Re-check license"}
        </button>
      </div>

      {expired && (
        <section className="renewal-banner" role="alert">
          <div>
            <span className="admin-kicker">RENEWAL REQUIRED</span>
            <h3>Your 30-day license has expired</h3>
            <p>
              Booking management, court edits, payments, QR codes, reports, and settings are paused
              until you renew. Your existing records stay readable — nothing was deleted.
            </p>
          </div>
          <div className="renewal-fee">
            <span>Monthly fee</span>
            <strong>{formatCurrency(monthlyFee)}</strong>
          </div>
        </section>
      )}

      {expired && (
        <div className="renewal-cta">
          <button className="button" type="button" onClick={renewNow}>
            Renew for {formatCurrency(monthlyFee)} <span aria-hidden="true">-&gt;</span>
          </button>
          <button
            className="button outline"
            type="button"
            onClick={recheck}
            disabled={checking || loading}>
            {checking ? "Checking..." : "I have paid — Re-check license"}
          </button>
        </div>
      )}

      {error && <ErrorMessage message={error} />}
      {notice && <p className="success-message">{notice}</p>}

      {loading ? (
        <p className="loading-state">Loading subscription...</p>
      ) : license ? (
        <>
          <section className="subscription-section">
            <div className="admin-section-heading">
              <div>
                <span className="admin-kicker">CURRENT LICENSE</span>
                <h3>License status</h3>
              </div>
              <span className={`status ${license.isActive ? "status-paid" : "status-expired"}`}>
                {license.isActive ? "active" : license.status}
              </span>
            </div>
            <div className="subscription-grid">
              <div>
                <span>License status</span>
                <strong>{license.isActive ? "Active" : license.status}</strong>
              </div>
              <div>
                <span>Payment status</span>
                <strong>{license.paymentStatus}</strong>
              </div>
              <div>
                <span>Monthly fee</span>
                <strong>{formatCurrency(license.monthlyFee)}</strong>
              </div>
              <div>
                <span>Valid for</span>
                <strong>30 days per payment</strong>
              </div>
              <div>
                <span>Start date</span>
                <strong>{formatDateTime(license.startDate)}</strong>
              </div>
              <div>
                <span>Expiration date</span>
                <strong>{formatDateTime(license.expiresAt)}</strong>
              </div>
              <div>
                <span>Days remaining</span>
                <strong>{license.daysRemaining == null ? "—" : `${license.daysRemaining} days`}</strong>
              </div>
              <div>
                <span>Last payment</span>
                <strong>
                  {license.lastAmount == null
                    ? "—"
                    : `${formatCurrency(license.lastAmount)} on ${formatDateTime(license.lastPaymentAt)}`}
                </strong>
              </div>
            </div>
            <p className="settings-note">
              License dates, payment status, and expiry are managed by your software provider in
              Supabase and cannot be edited here — this page is read-only.
            </p>
          </section>

          <section className="subscription-section">
            <div className="admin-section-heading">
              <div>
                <span className="admin-kicker">HOW TO RENEW</span>
                <h3>Renewal instructions</h3>
              </div>
            </div>
            <ol className="renewal-steps">
              {RENEWAL_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>

          <section className="subscription-section">
            <div className="admin-section-heading">
              <div>
                <span className="admin-kicker">PAYMENT HISTORY</span>
                <h3>Renewals and license payments</h3>
              </div>
              <span className="result-count">{payments.length} records</span>
            </div>
            {payments.length === 0 ? (
              <div className="empty-panel">No license payments recorded yet.</div>
            ) : (
              <div className="table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Paid at</th>
                      <th>Amount</th>
                      <th>Method</th>
                      <th>Reference</th>
                      <th>Valid period</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id}>
                        <td data-label="Paid at">{formatDateTime(payment.paidAt)}</td>
                        <td data-label="Amount">{formatCurrency(payment.amount)}</td>
                        <td data-label="Method">{payment.method}</td>
                        <td data-label="Reference">{payment.reference || "—"}</td>
                        <td data-label="Valid period">
                          {formatDateTime(payment.periodStart)} to {formatDateTime(payment.periodEnd)}
                        </td>
                        <td data-label="Status">
                          <span className={`status status-${payment.status}`}>{payment.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {events.length > 0 && (
            <section className="subscription-section">
              <div className="admin-section-heading">
                <div>
                  <span className="admin-kicker">STATUS CHANGES</span>
                  <h3>License activity</h3>
                </div>
              </div>
              <div className="activity-list">
                {events.slice(0, 8).map((event) => (
                  <div key={event.id}>
                    <span className="activity-dot green" />
                    {event.event_type}
                    {event.old_status && event.new_status && event.old_status !== event.new_status
                      ? ` (${event.old_status} to ${event.new_status})`
                      : ""}
                    <small>{formatDateTime(event.created_at)}</small>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        !error && <div className="empty-panel">No subscription record found.</div>
      )}

      {expired && (
        <p className="settings-note">
          Need your records while expired? <Link to="/admin/bookings">View bookings</Link>,{" "}
          <Link to="/admin/customers">customers</Link>, and <Link to="/admin/payments">payments</Link> —
          they stay readable in read-only mode.
        </p>
      )}
    </div>
  );
}

