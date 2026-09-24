import { Icon } from "./Icon";

/**
 * Consistent empty state used across dashboards, tables and lists. Gives every
 * "nothing here" panel the same structure: optional icon, a title, a short
 * description and an optional call to action.
 */
export function EmptyState({
  icon = "court",
  title = "Nothing here yet",
  description = "",
  action = null,
  compact = false,
}) {
  return (
    <div className={`ui-empty${compact ? " ui-empty-compact" : ""}`}>
      {icon && (
        <span className="ui-empty-icon" aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
      )}
      {title && <strong className="ui-empty-title">{title}</strong>}
      {description && <p className="ui-empty-text">{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}