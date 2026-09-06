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
      <span>{time}</span>
      <small>{available ? "Open" : "Booked"}</small>
    </button>
  );
}
