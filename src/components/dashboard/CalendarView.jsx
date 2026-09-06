import { TimeSlot } from "../booking/TimeSlot";
import { formatTime12 } from "../../utils/dateUtils";
export function CalendarView({ courts, onSlotClick }) {
  return (
    <div className="admin-calendar-grid">
      <div className="calendar-corner">TIME</div>
      {courts.map((court) => (
        <div className="calendar-court-head" key={court.id}>
          {court.name}
          <small>₱300 / hr</small>
        </div>
      ))}
      {["17:00", "18:00", "19:00", "20:00", "21:00"].map((time) => (
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
