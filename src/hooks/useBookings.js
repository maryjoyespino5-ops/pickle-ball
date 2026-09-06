import { useEffect, useState } from "react";
import { bookingService } from "../services/bookingService";
export function useBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    setLoading(true);
    bookingService
      .getMyBookings()
      .then(setBookings)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);
  const cancel = async (id) => {
    const updated = await bookingService.cancelBooking(id);
    setBookings((current) =>
      current.map((booking) => (booking.id === id ? updated : booking)),
    );
  };
  return { bookings, loading, error, cancel };
}
