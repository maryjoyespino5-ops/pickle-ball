export function CourtStatus({ status = "available", detail }) {
  return (
    <span className={`court-status status-${status}`}>
      <i />
      {status}
      {detail && <small>{detail}</small>}
    </span>
  );
}
