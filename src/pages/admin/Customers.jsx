import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "../../components/common/Modal";
import { customerService } from "../../services/customerService";
import { formatCurrency } from "../../utils/currencyUtils";
export function Customers() {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    customerService.getCustomers(search).then(setCustomers);
  }, [search]);
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
                <td>
                  <strong>{customer.name}</strong>
                </td>
                <td>{customer.email}</td>
                <td>{customer.phone}</td>
                <td>{customer.totalBookings}</td>
                <td>{formatCurrency(customer.totalSpent)}</td>
                <td>{customer.lastBooking}</td>
                <td>
                  <span className={`status status-${customer.status}`}>
                    {customer.status}
                  </span>
                </td>
                <td>
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
                          <td>
                            <strong>{booking.id}</strong>
                          </td>
                          <td>{booking.courtName}</td>
                          <td>
                            {booking.date} {booking.time}
                          </td>
                          <td>{formatCurrency(booking.amount)}</td>
                          <td>
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
