import { useEffect, useState } from "react";
import { reportService } from "../../services/reportService";
import { formatCurrency } from "../../utils/currencyUtils";
export function Reports() {
  const [report, setReport] = useState(null);
  const [filters, setFilters] = useState({
    from: "2026-09-01",
    to: "2026-09-18",
    court: "all",
    status: "all",
    paymentStatus: "all",
  });
  useEffect(() => {
    reportService.getReport(filters).then(setReport);
  }, [filters]);
  const updateFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const exportReport = () => {
    const rows = [
      "Booking ID,Customer,Court,Date,Amount,Status,Payment",
      ...report.rows.map((booking) =>
        [
          booking.id,
          booking.customer,
          booking.courtName,
          booking.date,
          booking.amount,
          booking.status,
          booking.paymentStatus,
        ].join(","),
      ),
    ];
    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rally-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  if (!report)
    return (
      <div className="admin-page">
        <p className="loading-state">Loading report...</p>
      </div>
    );
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">THE BIG PICTURE</span>
          <h2>Reports</h2>
          <p>Simple signals to help you understand the week at Rally.</p>
        </div>
        <div className="report-filters">
          <input
            type="date"
            value={filters.from}
            onChange={(event) => updateFilter("from", event.target.value)}
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) => updateFilter("to", event.target.value)}
          />
          <select
            value={filters.court}
            onChange={(event) => updateFilter("court", event.target.value)}>
            <option value="all">All courts</option>
            <option value="court-1">Court 1</option>
            <option value="court-2">Court 2</option>
          </select>
          <select
            value={filters.status}
            onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="all">All booking statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={filters.paymentStatus}
            onChange={(event) =>
              updateFilter("paymentStatus", event.target.value)
            }>
            <option value="all">All payment statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="refunded">Refunded</option>
          </select>
          <button className="button outline" onClick={exportReport}>
            Export report
          </button>
        </div>
      </div>
      <section className="report-section">
        <div className="admin-section-heading">
          <div>
            <span className="admin-kicker">BOOKING SUMMARY</span>
            <h3>Booking performance</h3>
          </div>
        </div>
        <div className="report-stat-grid">
          <div>
            <span>Total bookings</span>
            <strong>{report.total}</strong>
          </div>
          <div>
            <span>Completed</span>
            <strong>{report.completed}</strong>
          </div>
          <div>
            <span>Confirmed</span>
            <strong>{report.confirmed}</strong>
          </div>
          <div>
            <span>Cancelled</span>
            <strong>{report.cancelled}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>{report.pending}</strong>
          </div>
        </div>
      </section>
      <section className="report-section">
        <div className="admin-section-heading">
          <div>
            <span className="admin-kicker">REVENUE SUMMARY</span>
            <h3>Money movement</h3>
          </div>
        </div>
        <div className="revenue-grid">
          <div>
            <span>Total revenue</span>
            <strong>{formatCurrency(report.revenue)}</strong>
          </div>
          <div>
            <span>Paid revenue</span>
            <strong>{formatCurrency(report.paidRevenue)}</strong>
          </div>
          <div>
            <span>Pending payments</span>
            <strong>{formatCurrency(report.pendingRevenue)}</strong>
          </div>
        </div>
      </section>
      <section className="report-bottom">
        <div className="chart-card">
          <div className="admin-section-heading">
            <div>
              <span className="admin-kicker">LAST 7 DAYS</span>
              <h3>Bookings over time</h3>
            </div>
          </div>
          <div className="bar-chart">
            {report.trend.map((value, index) => (
              <div className="bar-column" key={index}>
                <span style={{ height: `${value * 10}%` }} />
                <small>{["M", "T", "W", "T", "F", "S", "S"][index]}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="performance-card">
          <div className="admin-section-heading">
            <div>
              <span className="admin-kicker">COURT PERFORMANCE</span>
              <h3>Bookings by court</h3>
            </div>
          </div>
          {report.courtPerformance.map((court) => (
            <div className="performance-row" key={court.name}>
              <span>{court.name}</span>
              <strong>{court.bookings} bookings</strong>
              <i style={{ width: `${court.share || 0}%` }} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
