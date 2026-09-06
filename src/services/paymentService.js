import { bookingService } from "./bookingService";
export function getPayments() {
  return bookingService.getAllBookings();
}
export function updatePayment(id, paymentStatus) {
  return bookingService.updateBooking(id, { paymentStatus });
}
export const paymentService = { getPayments, updatePayment };
