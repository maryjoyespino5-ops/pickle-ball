import { useEffect, useState } from "react";
import { Modal } from "../../components/common/Modal";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { paymentService } from "../../services/paymentService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
export function Payments() {
  const [payments, setPayments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    date: "",
  });
  const [refundTarget, setRefundTarget] = useState(null);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    paymentService
      .getPayments()
      .then(setPayments)
      .catch((err) =>
        setActionError(err.message || "Could not load payments."),
      );
  }, []);
  const markPaid = async (id) => {
    setActionError("");
    try {
      const next = await paymentService.updatePayment(id, "paid");
      setPayments((items) =>
        items.map((item) => (item.id === next.id ? next : item)),
      );
    } catch (err) {
      setActionError(err.message || "Could not mark this payment as paid.");
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
      setActionError(err.message || "Could not refund this payment.");
    }
  };
  return (
    <div className="admin-page">
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
      {actionError && <ErrorMessage message={actionError} />}
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
                  {payment.paymentStatus === "pending" && (
                    <button
                      className="row-link"
                      onClick={() => markPaid(payment.id)}>
                      Mark paid
                    </button>
                  )}
                  {payment.paymentStatus === "paid" && (
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
      {selected && (
        <Modal
          title={`Payment ${selected.id}`}
          onClose={() => setSelected(null)}>
          <div className="payment-detail">
            <p>
              <strong>{selected.customer}</strong>
              <br />
              {selected.courtName} · {selected.date} · {formatTime12(selected.time)}
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
