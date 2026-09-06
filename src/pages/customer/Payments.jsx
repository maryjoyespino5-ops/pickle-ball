import { useEffect, useState } from "react";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { paymentService } from "../../services/paymentService";
import { formatCurrency } from "../../utils/currencyUtils";

function formatTime(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

export function Payments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    paymentService
      .getMyPayments()
      .then(setPayments)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">YOUR RALLY</span>
          <h1>Payments</h1>
          <p>A record of every hour you have paid for.</p>
        </div>
        <Button to="/book">
          Book a court <span aria-hidden="true">-&gt;</span>
        </Button>
      </div>
      {error ? (
        <ErrorMessage message="Unable to load your payments. Please try again." />
      ) : loading ? (
        <p className="loading-state">Loading payments...</p>
      ) : payments.length ? (
        <div className="table-wrap">
          <table className="booking-table">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Court</th>
                <th>Date &amp; time</th>
                <th>Amount</th>
                <th>Method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>
                    <strong>{payment.bookingNumber}</strong>
                  </td>
                  <td>{payment.courtName || "—"}</td>
                  <td>
                    {payment.bookingDate || "—"}
                    {payment.startTime && (
                      <>
                        <br />
                        <small>{formatTime(payment.startTime)}</small>
                      </>
                    )}
                  </td>
                  <td>{formatCurrency(payment.amount)}</td>
                  <td>
                    {payment.method}
                    {payment.reference && (
                      <br />
                    )}
                    {payment.reference && (
                      <small className="payment-status">{payment.reference}</small>
                    )}
                  </td>
                  <td>
                    <span className={`status status-${payment.status}`}>
                      {payment.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-panel">
          No payments yet.{" "}
          <Button to="/book">Book your first hour.</Button>
        </div>
      )}
    </main>
  );
}