/**
 * Shared loading indicator. Renders a spinner with an optional label so every
 * loading state across the app looks the same instead of a bare "Loading...".
 */
export function Loading({ label = "Loading…", inline = false }) {
  return (
    <span
      className={`ui-loading${inline ? " ui-loading-inline" : ""}`}
      role="status"
      aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" />
      {label && <span className="ui-loading-label">{label}</span>}
    </span>
  );
}

/**
 * Skeleton block for content placeholders (tables, cards, lists). Give it a
 * width/height via style or the `lines` prop for text placeholders.
 */
export function Skeleton({ width, height = 16, radius = 8, className = "" }) {
  return (
    <span
      className={`ui-skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}
