import { formatCurrency } from "../../utils/currencyUtils";

/**
 * When the courts are actually wanted.
 *
 * A heat strip across the operating day, plus a weekday breakdown. The point is
 * to make the empty slots obvious: a pale column is a court sitting idle that
 * the owner could promote, fill with a walk-in, or stop paying staff for.
 *
 * Height is relative to the busiest hour, and `max` is passed in rather than
 * recomputed so a single very busy hour cannot flatten the rest.
 */
export function DemandHeatmap({ hours = [], max = 1, weekdays = [], weekdayMax = 1 }) {
  if (!hours.length) {
    return <p className="chart-empty">No bookings in this range yet.</p>;
  }

  return (
    <div className="demand">
      <div className="demand-hours">
        {hours.map((slot) => {
          const share = Math.round((slot.bookings / max) * 100);
          return (
            <div className="demand-hour" key={slot.hour}>
              {/* title gives the exact numbers; the colour only shows relative load. */}
              <span
                className="demand-bar"
                style={{ height: `${Math.max(slot.bookings ? 8 : 2, share)}%` }}
                title={`${slot.label} — ${slot.bookings} booking${slot.bookings === 1 ? "" : "s"}, ${formatCurrency(slot.revenue)}`}
              />
              <small>{slot.label}</small>
            </div>
          );
        })}
      </div>

      <div className="demand-weekdays">
        {weekdays.map((day) => (
          <div className="demand-weekday" key={day.label}>
            <span
              className="demand-weekday-fill"
              style={{
                width: `${Math.max(day.bookings ? 6 : 2, Math.round((day.bookings / weekdayMax) * 100))}%`,
              }}
              title={`${day.label} — ${day.bookings} booking${day.bookings === 1 ? "" : "s"}, ${formatCurrency(day.revenue)}`}
            />
            <span className="demand-weekday-label">{day.label}</span>
            <strong>{day.bookings}</strong>
          </div>
        ))}
      </div>

      <p className="demand-note">
        Tall bars are the slots that sell. Short or empty ones are the gap — courts
        reserved but unclaimed.
      </p>
    </div>
  );
}
