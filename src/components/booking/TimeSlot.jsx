import { formatTime12 } from "../../utils/dateUtils";

export function TimeSlot({
  time,
  available = true,
  past = false,
  selected = false,
  onClick,
  hint = "",
}) {
  // A booked slot always carries the "booked" class so every calendar
  // (admin calendar, customer booking, public availability) shows the same
  // orange BOOKED status for the same slot. Hours that already started today
  // carry "past" instead — they can never be booked again.
  const title =
    hint ||
    (past
      ? "This time has already passed"
      : available
        ? ""
        : "This time is already booked");
  return (
    <button
      type="button"
      className={`time-slot ${past ? "past" : ""} ${available ? "" : "booked"} ${selected ? "selected" : ""}`}
      disabled={!available && !onClick}
      title={title || undefined}
      aria-label={
        past
          ? `${formatTime12(time)} - passed`
          : available
            ? `${formatTime12(time)} - open`
            : `${formatTime12(time)} - booked`
      }
      onClick={onClick}>
      <span>{formatTime12(time)}</span>
      <small>{past ? "Past" : available ? "Open" : "Booked"}</small>
    </button>
  );
}
