import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../../components/common/Modal";
import { customerService } from "../../services/customerService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { debounce } from "../../utils/debounce";
export function Customers() {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const navigate = useNavigate();
  const requestId = useMemo(() => ({ current: 0 }), []);
  const debouncedFetch = useMemo(
    () =>
      debounce((activeSearch) => {
        const myRequest = (requestId.current += 1);
        customerService
          .getCustomers(activeSearch)
          .then((rows) => {
            // Ignore stale responses when the search changed mid-flight (B32).
            if (requestId.current === myRequest) setCustomers(rows);
          })
          .catch(() => {});
      }, 300),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    debouncedFetch(search);
    return () => debouncedFetch.cancel();
  }, [search, debouncedFetch]);
  const openDetails = (customer) => {
    setSelected(customer);
    setDetails(null);
    customerService
      .getCustomer(customer.id)
      .then(setDetails)
      .catch(() => setDetails(null));
  };
  return (
    <div className="admin-page">
      <div className="admin-page-heading">
        <div>
          <span className="admin-kicker">CUSTOMER DIRECTORY</span>
          <h2>Customers</h2>
          <p>Understand who is playing and how often they come back.</p>
        </div>
        <span className="result-count">{customers.length} customers</span>
      </div>
      <div className="admin-filters single-filter">
        <input
          placeholder="Search name, email, or phone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Total bookings</th>
              <th>Total spent</th>
              <th>Last booking</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td data-label="Customer">
                  <strong>{customer.name}</strong>
                </td>
                <td data-label="Email">{customer.email}</td>
                <td data-label="Phone">{customer.phone}</td>
                <td data-label="Total bookings">{customer.totalBookings}</td>
                <td data-label="Total spent">{formatCurrency(customer.totalSpent)}</td>
                <td data-label="Last booking">{customer.lastBooking}</td>
                <td data-label="Status">
                  <span className={`status status-${customer.status}`}>
                    {customer.status}
                  </span>
                </td>
                <td className="table-action-cell">
                  <button
                    className="row-link"
                    onClick={() => openDetails(customer)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <Modal title="Customer profile" onClose={() => setSelected(null)}>
          <div className="customer-details">
            <div className="customer-details-head">
              <span className="admin-avatar">
                {selected.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </span>
              <div>
                <h3>{selected.name}</h3>
                <p>
                  {selected.email}
                  <br />
                  {selected.phone}
                </p>
              </div>
            </div>
            <div className="customer-stat-row">
              <div>
                <small>Total bookings</small>
                <strong>{selected.totalBookings}</strong>
              </div>
              <div>
                <small>Total spent</small>
                <strong>{formatCurrency(selected.totalSpent)}</strong>
              </div>
            </div>
            <h4>Recent bookings</h4>
            <div className="customer-booking-actions">
              {!details ? (
                <div className="empty-panel">Loading booking history...</div>
              ) : details.bookings.length === 0 ? (
                <div className="empty-panel">
                  No bookings yet for this customer.
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Booking</th>
                        <th>Court</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.bookings.map((booking) => (
                        <tr key={booking.id}>
                          <td data-label="Booking">
                            <strong>{booking.id}</strong>
                          </td>
                          <td data-label="Court">{booking.courtName}</td>
                          <td data-label="Date">
                            {booking.date} {formatTime12(booking.time)}
                          </td>
                          <td data-label="Amount">{formatCurrency(booking.amount)}</td>
                          <td data-label="Status">
                            <span className={`status status-${booking.status}`}>
                              {booking.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                className="button outline"
                onClick={() =>
                  navigate(
                    `/admin/bookings?search=${encodeURIComponent(selected.name)}`,
                  )
                }>
                View booking history
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
