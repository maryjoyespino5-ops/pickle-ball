import { useCallback, useEffect, useState } from "react";
import { bookingService } from "../services/bookingService";
import { useRealtimeBookings } from "./useRealtimeBookings";

export function useBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(() => {
    return bookingService
      .getMyBookings()
      .then(setBookings)
      .catch((err) => setError(err));
  }, []);

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  // Live updates: when this customer books (or an admin reschedules/cancels
  // their booking), the dashboard/history refresh automatically.
  useRealtimeBookings(refetch);

  const cancel = async (id) => {
    const updated = await bookingService.cancelBooking(id);
    setBookings((current) =>
      current.map((booking) => (booking.id === id ? updated : booking)),
    );
  };
  return { bookings, loading, error, cancel, refetch };
}
