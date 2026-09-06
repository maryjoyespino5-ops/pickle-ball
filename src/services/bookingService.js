import {
  BOOKING_STATUSES,
  COURTS,
  HOURLY_RATE,
  PAYMENT_STATUSES,
} from "../lib/constants";

const demoBookings = [
  {
    id: "RB-240918-01",
    courtId: "court-1",
    courtName: "Court 1",
    date: "2026-09-18",
    time: "14:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: BOOKING_STATUSES.UPCOMING,
    paymentStatus: PAYMENT_STATUSES.PAID,
  },
  {
    id: "RB-240912-02",
    courtId: "court-2",
    courtName: "Court 2",
    date: "2026-09-12",
    time: "18:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: BOOKING_STATUSES.COMPLETED,
    paymentStatus: PAYMENT_STATUSES.PAID,
  },
  {
    id: "RB-240905-03",
    courtId: "court-1",
    courtName: "Court 1",
    date: "2026-09-05",
    time: "09:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: BOOKING_STATUSES.CANCELLED,
    paymentStatus: PAYMENT_STATUSES.PENDING,
  },
];

let bookings = [...demoBookings];

const adminBookings = [
  {
    id: "PB-001",
    customer: "Juan Dela Cruz",
    email: "juan@example.com",
    phone: "+63 917 111 2233",
    courtId: "court-1",
    courtName: "Court 1",
    date: "2026-09-18",
    time: "18:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "confirmed",
    paymentStatus: "paid",
    paymentMethod: "GCash",
    createdAt: "2026-09-14 09:20",
  },
  {
    id: "PB-002",
    customer: "Maria Santos",
    email: "maria@example.com",
    phone: "+63 917 222 3344",
    courtId: "court-2",
    courtName: "Court 2",
    date: "2026-09-18",
    time: "19:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "confirmed",
    paymentStatus: "pending",
    paymentMethod: "Pay at Court",
    createdAt: "2026-09-15 11:05",
  },
  {
    id: "PB-003",
    customer: "Carlo Reyes",
    email: "carlo@example.com",
    phone: "+63 917 333 4455",
    courtId: "court-1",
    courtName: "Court 1",
    date: "2026-09-18",
    time: "20:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "pending",
    paymentStatus: "pending",
    paymentMethod: "GCash",
    createdAt: "2026-09-16 14:15",
  },
  {
    id: "PB-004",
    customer: "Ana Lim",
    email: "ana@example.com",
    phone: "+63 917 444 5566",
    courtId: "court-2",
    courtName: "Court 2",
    date: "2026-09-18",
    time: "17:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "completed",
    paymentStatus: "paid",
    paymentMethod: "GCash",
    createdAt: "2026-09-10 08:30",
  },
  {
    id: "PB-005",
    customer: "Nico Garcia",
    email: "nico@example.com",
    phone: "+63 917 555 6677",
    courtId: "court-1",
    courtName: "Court 1",
    date: "2026-09-18",
    time: "16:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "confirmed",
    paymentStatus: "paid",
    paymentMethod: "Pay at Court",
    createdAt: "2026-09-16 16:40",
  },
  {
    id: "PB-006",
    customer: "Lena Cruz",
    email: "lena@example.com",
    phone: "+63 917 666 7788",
    courtId: "court-2",
    courtName: "Court 2",
    date: "2026-09-18",
    time: "15:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "cancelled",
    paymentStatus: "refunded",
    paymentMethod: "GCash",
    createdAt: "2026-09-12 12:15",
  },
  {
    id: "PB-007",
    customer: "Paolo Tan",
    email: "paolo@example.com",
    phone: "+63 917 777 8899",
    courtId: "court-1",
    courtName: "Court 1",
    date: "2026-09-18",
    time: "13:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "confirmed",
    paymentStatus: "paid",
    paymentMethod: "GCash",
    createdAt: "2026-09-17 10:05",
  },
  {
    id: "PB-008",
    customer: "Mia Santos",
    email: "mia@example.com",
    phone: "+63 917 555 0188",
    courtId: "court-2",
    courtName: "Court 2",
    date: "2026-09-20",
    time: "10:00",
    duration: 1,
    amount: HOURLY_RATE,
    status: "confirmed",
    paymentStatus: "paid",
    paymentMethod: "GCash",
    createdAt: "2026-09-17 13:30",
  },
];
let managedBookings = [...adminBookings];

export function getMyBookings() {
  return Promise.resolve([...bookings]);
}
export function createBooking({ courtId, date, time }) {
  const court = COURTS.find((item) => item.id === courtId);
  const booking = {
    id: `RB-${date.replaceAll("-", "")}-${bookings.length + 1}`,
    courtId,
    courtName: court.name,
    date,
    time,
    duration: 1,
    amount: HOURLY_RATE,
    status: BOOKING_STATUSES.UPCOMING,
    paymentStatus: PAYMENT_STATUSES.PENDING,
  };
  bookings = [booking, ...bookings];
  return Promise.resolve(booking);
}
export function cancelBooking(id) {
  bookings = bookings.map((booking) =>
    booking.id === id
      ? { ...booking, status: BOOKING_STATUSES.CANCELLED }
      : booking,
  );
  return Promise.resolve(bookings.find((booking) => booking.id === id));
}

export function getAllBookings(filters = {}) {
  let result = [...managedBookings];
  if (filters.search) {
    const term = filters.search.toLowerCase();
    result = result.filter((booking) =>
      `${booking.id} ${booking.customer} ${booking.courtName}`
        .toLowerCase()
        .includes(term),
    );
  }
  if (filters.date)
    result = result.filter((booking) => booking.date === filters.date);
  if (filters.court && filters.court !== "all")
    result = result.filter((booking) => booking.courtId === filters.court);
  if (filters.status && filters.status !== "all")
    result = result.filter((booking) => booking.status === filters.status);
  if (filters.paymentStatus && filters.paymentStatus !== "all")
    result = result.filter(
      (booking) => booking.paymentStatus === filters.paymentStatus,
    );
  return Promise.resolve(result);
}
export function updateBooking(id, changes) {
  managedBookings = managedBookings.map((booking) =>
    booking.id === id ? { ...booking, ...changes } : booking,
  );
  return Promise.resolve(managedBookings.find((booking) => booking.id === id));
}
export function createAdminBooking({
  courtId,
  date,
  time,
  customer,
  email,
  phone,
  duration = 1,
  paymentMethod = "Pay at Court",
}) {
  const overlaps = (booking) => {
    const start = Number(booking.time.slice(0, 2));
    const end = start + booking.duration;
    const nextStart = Number(time.slice(0, 2));
    const nextEnd = nextStart + Number(duration);
    return (
      booking.courtId === courtId &&
      booking.date === date &&
      booking.status !== "cancelled" &&
      start < nextEnd &&
      nextStart < end
    );
  };
  const overlap = managedBookings.some(overlaps);
  if (overlap)
    return Promise.reject(
      new Error("That court is already booked for this time."),
    );
  const court = COURTS.find((item) => item.id === courtId);
  const booking = {
    id: `PB-${String(managedBookings.length + 1).padStart(3, "0")}`,
    customer,
    email,
    phone,
    courtId,
    courtName: court.name,
    date,
    time,
    duration: Number(duration),
    amount: HOURLY_RATE * Number(duration),
    status: "confirmed",
    paymentStatus: "pending",
    paymentMethod,
    createdAt: new Date().toISOString(),
  };
  managedBookings = [booking, ...managedBookings];
  return Promise.resolve(booking);
}

export function rescheduleBooking(id, { courtId, date, time }) {
  const existing = managedBookings.find((booking) => booking.id === id);
  if (!existing) return Promise.reject(new Error("Booking was not found."));
  const start = Number(time.slice(0, 2));
  const overlap = managedBookings.some(
    (booking) =>
      booking.id !== id &&
      booking.courtId === courtId &&
      booking.date === date &&
      booking.status !== "cancelled" &&
      start < Number(booking.time.slice(0, 2)) + booking.duration &&
      Number(booking.time.slice(0, 2)) < start + existing.duration,
  );
  if (overlap)
    return Promise.reject(
      new Error("That court is already booked for this time."),
    );
  return updateBooking(id, {
    courtId,
    courtName: COURTS.find((court) => court.id === courtId).name,
    date,
    time,
  });
}

export const bookingService = {
  getMyBookings,
  createBooking,
  cancelBooking,
  getAllBookings,
  updateBooking,
  createAdminBooking,
  rescheduleBooking,
};
