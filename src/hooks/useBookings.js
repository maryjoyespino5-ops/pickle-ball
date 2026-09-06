import { useEffect, useState } from "react";
import { bookingService } from "../services/bookingService";
export function useBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    bookingService
      .getMyBookings()
      .then(setBookings)
      .finally(() => setLoading(false));
  }, []);
  const cancel = async (id) => {
    const updated = await bookingService.cancelBooking(id);
    setBookings((current) =>
      current.map((booking) => (booking.id === id ? updated : booking)),
    );
  };
  return { bookings, loading, error: null, cancel };
}
