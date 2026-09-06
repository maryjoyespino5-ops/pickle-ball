import { useEffect, useState } from "react";
import { courtService } from "../services/courtService";

export function useCourts() {
  const [courts, setCourts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    courtService
      .getCourts()
      .then(setCourts)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, []);
  return { courts, loading, error };
}
