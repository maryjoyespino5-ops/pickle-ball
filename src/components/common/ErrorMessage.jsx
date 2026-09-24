/**
 * Consistent inline error message. Uses the shared `.ui-alert` styling so it
 * matches every other alert across customer and admin pages.
 */
export function ErrorMessage({ message = "Something went wrong." }) {
  if (!message) return null;
  return (
    <p className="ui-alert ui-alert-error" role="alert">
      <span className="ui-alert-dot" aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}
