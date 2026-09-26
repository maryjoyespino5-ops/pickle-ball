import { useCallback, useEffect, useState } from "react";
import { Modal } from "../../components/common/Modal";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { paymentService } from "../../services/paymentService";
import { useRealtimeBookings } from "../../hooks/useRealtimeBookings";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { useSubscriptionLock } from "../../hooks/useSubscriptionLock";
import { SubscriptionLockedBanner } from "../../components/common/SubscriptionLockedBanner";
import { subscriptionService } from "../../services/subscriptionService";

/**
 * True when a payment was collected online (GCash via PayMongo) rather than in
 * cash at the desk. Those rows are settled by the PayMongo webhook or by
 * "Recover from PayMongo" — never by an admin typing "Mark paid".
 */
function isGcash(method) {
  return /gcash/i.test(String(method || ""));
}

export function Payments() {
  const { locked, refresh } = useSubscriptionLock();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    date: "",
  });
  const [refundTarget, setRefundTarget] = useState(null);
  const [reconcilingId, setReconcilingId] = useState("");
  const [actionError, setActionError] = useState("");
  const load = useCallback(() => {
    setActionError("");
    setLoading(true);
    paymentService
      .getPayments()
      .then(setPayments)
      .catch((err) =>
        setActionError(err.message || "Could not load payments."),
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // The admin payments table used to load once and then sit stale: a player's
  // GCash payment landing at PayMongo flipped the status server-side while the
  // screen still read "pending" until a manual refresh. Realtime on the same
  // shared bus as the other dashboards keeps the money column truthful.
  useRealtimeBookings(load);
  const markPaid = async (id) => {
    if (locked) {
      setActionError("Your software license has expired. Renew the subscription to continue.");
      refresh();
      return;
    }
    setActionError("");
    try {
      const next = await paymentService.updatePayment(id, "paid");
      setPayments((items) =>
        items.map((item) => (item.id === next.id ? next : item)),
      );
    } catch (err) {
      setActionError(subscriptionService.subscriptionErrorMessage(err, "Could not mark this payment as paid."));
      if (subscriptionService.isSubscriptionExpiredError(err)) refresh();
    }
  };
  /**
   * Recover a booking whose money was collected by PayMongo but which the
   * webhook never confirmed (the routing bug). This does NOT simply flip the
   * status: it calls reconcile_booking_payment, which reuses the webhook's own
   * atomic confirm path with its amount cross-check. Marking paid by hand stays
   * available for genuine pay-at-court cash.
   */
  const reconcile = async (payment) => {
    if (locked) {
      setActionError(
        "Your software license has expired. Renew the subscription to continue.",
      );
      refresh();
      return;
    }
    setActionError("");
    setReconcilingId(payment.bookingNumber);
    try {
      const result = await paymentService.reconcilePayment(
        payment.bookingNumber,
      );
      if (result?.outcome === "amount_mismatch") {
        setActionError(
          `The amount PayMongo collected does not cover booking ${payment.bookingNumber}. Review it in the PayMongo dashboard.`,
        );
      } else if (result?.outcome === "not_found") {
        setActionError(
          `PayMongo has no matching payment for ${payment.bookingNumber}. Check the transaction in the PayMongo dashboard first.`,
        );
      } else {
        // confirmed | duplicate — the RPC already reported the settled state.
        load();
      }
    } catch (err) {
      setActionError(
        subscriptionService.subscriptionErrorMessage(
          err,
          "Could not reconcile this payment.",
        ),
      );
      if (subscriptionService.isSubscriptionExpiredError(err)) refresh();
    } finally {
      setReconcilingId("");
    }
  };
  const visible = payments.filter((payment) => {
    const matchesSearch = `${payment.id} ${payment.customer}`
      .toLowerCase()
      .includes(filters.search.toLowerCase());
    return (
      matchesSearch &&
      (filters.status === "all" || payment.paymentStatus === filters.status) &&
      (!filters.date || payment.date === filters.date)
    );
  });
  const refund = async () => {
    if (locked) {
      setActionError("Your software license has expired. Renew the subscription to continue.");
      refresh();
      return;
    }
    setActionError("");
    try {
      const next = await paymentService.updatePayment(
        refundTarget.id,
        "refunded",
      );
      setPayments((items) =>
        items.map((item) => (item.id === next.id ? next : item)),
      );
      setRefundTarget(null);
    } catch (err) {
      setActionError(subscriptionService.subscriptionErrorMessage(err, "Could not refund this payment."));
      if (subscriptionService.isSubscriptionExpiredError(err)) refresh();
    }
  };
  return (
    <div className="admin-page">
      <SubscriptionLockedBanner />
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">MONEY IN, MADE SIMPLE</span>
          <h2>Payments</h2>
          <p>Track payment status without adding a complicated gateway.</p>
        </div>
        <span className="result-count">{visible.length} records</span>
      </div>
      <div className="admin-filters payment-filters">
        <input
          placeholder="Search booking or customer"
          value={filters.search}
          onChange={(event) =>
            setFilters({ ...filters, search: event.target.value })
          }
        />
        <input
          type="date"
          value={filters.date}
          onChange={(event) =>
            setFilters({ ...filters, date: event.target.value })
          }
        />
        <select
          value={filters.status}
          onChange={(event) =>
            setFilters({ ...filters, status: event.target.value })
          }>
          <option value="all">All payment statuses</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>
      {actionError && (
        <div className="admin-load-row">
          <ErrorMessage message={actionError} />
          <button className="button outline" type="button" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {loading ? (
        <p className="loading-state">Loading payments...</p>
      ) : visible.length === 0 ? (
        <div className="empty-panel">
          No payments found. Try different filters.
        </div>
      ) : (
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Booking ID</th>
              <th>Customer</th>
              <th>Court</th>
              <th>Date</th>
              <th>Amount</th>
              <th>Payment method</th>
              <th>Payment status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((payment) => (
              <tr key={payment.id}>
                <td data-label="Booking ID">
                  <strong>{payment.id}</strong>
                </td>
                <td data-label="Customer">{payment.customer}</td>
                <td data-label="Court">{payment.courtName}</td>
                <td data-label="Date">{payment.date}</td>
                <td data-label="Amount">{formatCurrency(payment.amount)}</td>
                <td data-label="Payment method">{payment.paymentMethod}</td>
                <td data-label="Payment status">
                  <span className={`status status-${payment.paymentStatus}`}>
                    {payment.paymentStatus}
                  </span>
                </td>
                <td className="table-action-cell">
                  <div className="row-actions">
                  <button
                    className="row-link"
                    onClick={() => setSelected(payment)}>
                    View
                  </button>
                  {/* "Mark paid" records CASH collected at the desk. It must
                      never be offered for a GCash booking: that money moved
                      through PayMongo, and hand-flipping it would let an admin
                      mark a court paid that was never paid for. A GCash row
                      that is still pending gets "Recover from PayMongo" below,
                      which asks PayMongo what actually happened. */}
                  {payment.paymentStatus === "pending" &&
                    !locked &&
                    !isGcash(payment.paymentMethod) && (
                      <button
                        className="row-link"
                        onClick={() => markPaid(payment.id)}>
                        Mark paid
                      </button>
                    )}
                  {payment.paymentStatus === "pending" && !locked && (
                    <button
                      className="row-link"
                      title="Confirm this booking from the PayMongo payment that was actually collected"
                      disabled={reconcilingId === payment.bookingNumber}
                      onClick={() => reconcile(payment)}>
                      {reconcilingId === payment.bookingNumber
                        ? "Checking..."
                        : "Recover from PayMongo"}
                    </button>
                  )}
                  {payment.paymentStatus === "paid" && !locked && (
                    <button
                      className="row-link"
                      onClick={() => setRefundTarget(payment)}>
                      Refund
                    </button>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {selected && (
        <Modal
          title={`Payment ${selected.id}`}
          onClose={() => setSelected(null)}>
          <div className="payment-detail">
            <p>
              <strong>{selected.customer}</strong>
              <br />
              {selected.courtName} Â· {selected.date} Â· {formatTime12(selected.time)}
            </p>
            <div className="payment-total">
              {formatCurrency(selected.amount)}
              <span>{selected.paymentMethod}</span>
            </div>
            <span className={`status status-${selected.paymentStatus}`}>
              {selected.paymentStatus}
            </span>
          </div>
        </Modal>
      )}
      {refundTarget && (
        <Modal title="Refund payment?" onClose={() => setRefundTarget(null)}>
          <div className="confirm-dialog">
            <p>
              Refund the payment for <strong>{refundTarget.id}</strong>?
            </p>
            <div>
              <button className="button danger" onClick={refund}>
                Refund payment
              </button>
              <button
                className="button outline"
                onClick={() => setRefundTarget(null)}>
                Keep payment
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
