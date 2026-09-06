const customers = [
  {
    id: "cus-1",
    name: "Juan Dela Cruz",
    email: "juan@example.com",
    phone: "+63 917 111 2233",
    totalBookings: 12,
    totalSpent: 3600,
    lastBooking: "2026-09-18",
    status: "active",
  },
  {
    id: "cus-2",
    name: "Maria Santos",
    email: "maria@example.com",
    phone: "+63 917 222 3344",
    totalBookings: 8,
    totalSpent: 2400,
    lastBooking: "2026-09-18",
    status: "active",
  },
  {
    id: "cus-3",
    name: "Carlo Reyes",
    email: "carlo@example.com",
    phone: "+63 917 333 4455",
    totalBookings: 5,
    totalSpent: 1500,
    lastBooking: "2026-09-18",
    status: "active",
  },
  {
    id: "cus-4",
    name: "Ana Lim",
    email: "ana@example.com",
    phone: "+63 917 444 5566",
    totalBookings: 16,
    totalSpent: 4800,
    lastBooking: "2026-09-17",
    status: "active",
  },
  {
    id: "cus-5",
    name: "Nico Garcia",
    email: "nico@example.com",
    phone: "+63 917 555 6677",
    totalBookings: 3,
    totalSpent: 900,
    lastBooking: "2026-09-16",
    status: "inactive",
  },
];
export function getCustomers(search = "") {
  const term = search.toLowerCase();
  return Promise.resolve(
    customers.filter((customer) =>
      `${customer.name} ${customer.email} ${customer.phone}`
        .toLowerCase()
        .includes(term),
    ),
  );
}
export function getCustomer(id) {
  return Promise.resolve(customers.find((customer) => customer.id === id));
}
export const customerService = { getCustomers, getCustomer };
