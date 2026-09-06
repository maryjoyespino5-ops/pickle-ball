export function StatCard({ label, value = 0 }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>All time</small>
    </article>
  );
}
