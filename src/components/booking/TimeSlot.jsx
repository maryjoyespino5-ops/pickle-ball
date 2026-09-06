import { formatTime12 } from "../../utils/dateUtils";

export function TimeSlot({
  time,
  available = true,
  selected = false,
  onClick,
}) {
  return (
    <button
      type="button"
      className={`time-slot ${selected ? "selected" : ""}`}
      disabled={!available && !onClick}
      onClick={onClick}>
      <span>{formatTime12(time)}</span>
      <small>{available ? "Open" : "Booked"}</small>
    </button>
  );
}
