/** "18:00" / "18:00:00" -> "6:00 PM" (12-hour, no military time). */
export function formatTime12(value) {
  if (!value) return "";
  const parts = String(value).slice(0, 5).split(":");
  const hours = Number(parts[0]);
  const minutes = parts[1] || "00";
  if (Number.isNaN(hours)) return String(value);
  const period = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${period}`;
}

/** "18:00" + 2 hours -> "6:00 PM - 8:00 PM". */
export function formatTimeRange12(startTime, durationHours = 1) {
  if (!startTime) return "";
  const start = String(startTime).slice(0, 5);
  const end =
    (Number(start.slice(0, 2)) + Number(durationHours || 1)) % 24 === 0
      ? "00:00"
      : `${String(Number(start.slice(0, 2)) + Number(durationHours || 1)).padStart(2, "0")}:${start.slice(3, 5)}`;
  return `${formatTime12(start)} - ${formatTime12(end)}`;
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function todayISO() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
