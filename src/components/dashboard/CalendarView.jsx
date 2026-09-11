import { TimeSlot } from "../booking/TimeSlot";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTime12 } from "../../utils/dateUtils";
import { buildCourtHours } from "../../services/facilityService";

function slotTimes(courts, facility) {
  const fromData = new Set();
  courts.forEach((court) =>
    (court.slots || []).forEach((slot) => fromData.add(slot.time)),
  );
  if (fromData.size > 0) return [...fromData].sort();
  return buildCourtHours(facility);
}

export function CalendarView({ courts, facility, onSlotClick }) {
  const times = slotTimes(courts, facility);
  return (
    <div className="admin-calendar-grid">
      <div className="calendar-corner">TIME</div>
      {courts.map((court) => (
        <div className="calendar-court-head" key={court.id}>
          {court.name}
          <small>
            {court.price ? `${formatCurrency(court.price)} / hr` : "Rate on request"}
          </small>
        </div>
      ))}
      {times.map((time) => (
        <div className="calendar-row" key={time}>
          <strong>{formatTime12(time)}</strong>
          {courts.map((court) => {
            const slot = court.slots?.find((item) => item.time === time) || {
              available: true,
            };
            return (
              <TimeSlot
                key={`${court.id}-${time}`}
                {...slot}
                onClick={() => onSlotClick(court, time, slot.available)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
