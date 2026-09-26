import { formatCurrency } from "../../utils/currencyUtils";

/**
 * Revenue over time — the "collection gap" chart.
 *
 * Two lines over the selected range:
 *   Collected   money that actually arrived (payment_status = paid)
 *   Outstanding money for courts that are reserved but not paid yet
 *
 * The vertical distance between them IS the gap. When outstanding runs above
 * collected, courts are being held without the money coming in — the owner can
 * see it on one glance instead of reconciling rows by hand.
 *
 * Hand-rolled SVG rather than a charting library: the project ships no chart
 * dependency, and this keeps the bundle small and the styling on-brand. It
 * scales with viewBox, so it is responsive without a resize listener.
 */
const W = 760;
const H = 260;
const PAD = { top: 18, right: 16, bottom: 34, left: 54 };

/** "2026-09-26" -> "26 Sep" */
function shortDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}`;
}

/** Round a max up to a friendly axis ceiling (500 -> 500, 730 -> 800). */
function niceMax(value) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  for (const step of steps) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

export function RevenueTrendChart({ data = [] }) {
  if (!data.length) {
    return (
      <p className="chart-empty">
        No bookings in this range, so there is no revenue to chart yet.
      </p>
    );
  }

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const peak = niceMax(
    Math.max(
      1,
      ...data.map((point) => Math.max(point.collected, point.outstanding)),
    ),
  );

  // A single day has no x-spread, so pin it to the middle instead of dividing
  // by zero.
  const x = (index) =>
    data.length === 1
      ? PAD.left + innerW / 2
      : PAD.left + (index / (data.length - 1)) * innerW;
  const y = (value) => PAD.top + innerH - (value / peak) * innerH;

  const line = (key) =>
    data
      .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`)
      .join(" ");

  const area = (key) =>
    `${line(key)} L${x(data.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => peak * fraction);
  // Label roughly 6 dates, whatever the range length.
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div className="trend-chart">
      <div className="chart-legend">
        <span className="chart-key chart-key-collected">
          Collected
          <strong>{formatCurrency(data.reduce((s, p) => s + p.collected, 0))}</strong>
        </span>
        <span className="chart-key chart-key-outstanding">
          Outstanding
          <strong>{formatCurrency(data.reduce((s, p) => s + p.outstanding, 0))}</strong>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trend-svg"
        role="img"
        aria-label={`Revenue over time: ${formatCurrency(
          data.reduce((s, p) => s + p.collected, 0),
        )} collected, ${formatCurrency(
          data.reduce((s, p) => s + p.outstanding, 0),
        )} outstanding`}
      >
        {/* Horizontal gridlines + y labels */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className="chart-grid"
            />
            <text x={PAD.left - 8} y={y(tick) + 4} className="chart-axis" textAnchor="end">
              {tick >= 1000 ? `${Math.round(tick / 1000)}k` : Math.round(tick)}
            </text>
          </g>
        ))}

        {/* Outstanding sits behind, collected reads as the headline. */}
        <path d={area("outstanding")} className="chart-area chart-area-outstanding" />
        <path d={line("outstanding")} className="chart-line chart-line-outstanding" />
        <path d={area("collected")} className="chart-area chart-area-collected" />
        <path d={line("collected")} className="chart-line chart-line-collected" />

        {/* Points carry a native tooltip: hover or keyboard-focus reveals the day. */}
        {data.map((point, index) => (
          <g key={point.date}>
            <circle cx={x(index)} cy={y(point.collected)} r={2.6} className="chart-dot chart-dot-collected">
              <title>{`${point.date} — collected ${formatCurrency(point.collected)}, outstanding ${formatCurrency(point.outstanding)}`}</title>
            </circle>
            <circle cx={x(index)} cy={y(point.outstanding)} r={2.6} className="chart-dot chart-dot-outstanding">
              <title>{`${point.date} — outstanding ${formatCurrency(point.outstanding)}`}</title>
            </circle>
            {index % labelEvery === 0 && (
              <text
                x={x(index)}
                y={H - PAD.bottom + 18}
                className="chart-axis"
                textAnchor="middle"
              >
                {shortDate(point.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
