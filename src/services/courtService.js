import { COURT_HOURS, COURTS } from "../lib/constants";

const bookedSlots = {
  "2026-09-18": {
    "court-1": ["08:00", "14:00", "17:00"],
    "court-2": ["09:00", "16:00"],
  },
  "2026-09-19": {
    "court-1": ["10:00", "11:00"],
    "court-2": ["08:00", "18:00", "19:00"],
  },
};
let managedCourts = COURTS.map((court, index) => ({
  ...court,
  price: court.price || 300,
  image: "court-default",
  status: index === 0 ? "available" : "occupied",
  enabled: true,
  maintenance: false,
}));

export function getCourts() {
  return Promise.resolve(COURTS);
}

export function getAvailability(date) {
  const day = bookedSlots[date] || {};
  return Promise.resolve(
    COURTS.map((court) => ({
      ...court,
      slots: COURT_HOURS.map((time) => ({
        time,
        available: !(day[court.id] || []).includes(time),
      })),
    })),
  );
}

export function getManagedCourts() {
  return Promise.resolve([...managedCourts]);
}
export function updateCourt(id, changes) {
  managedCourts = managedCourts.map((court) =>
    court.id === id ? { ...court, ...changes } : court,
  );
  return Promise.resolve(managedCourts);
}

export const courtService = {
  getCourts,
  getAvailability,
  getManagedCourts,
  updateCourt,
};
