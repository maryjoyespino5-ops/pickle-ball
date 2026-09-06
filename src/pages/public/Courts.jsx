import { CourtCard } from "../../components/courts/CourtCard";
import { useCourts } from "../../hooks/useCourts";
export function Courts() {
  const { courts, loading, error } = useCourts();
  return (
    <main className="page-wrap">
      <div className="page-intro">
        <span className="eyebrow">THE CLUB</span>
        <h1>
          Two courts.
          <br />
          <em>Endless rallies.</em>
        </h1>
        <p>Professional-quality courts, kept ready for your next game.</p>
      </div>
      {loading ? (
        <p className="loading-state">Loading courts...</p>
      ) : error ? (
        <p className="empty-panel">
          Courts are temporarily unavailable. Please try again later.
        </p>
      ) : (
        <div className="court-grid">
          {courts.map((court) => (
            <CourtCard key={court.id} court={court} />
          ))}
        </div>
      )}
      <section className="info-band">
        <span className="section-index">EVERYTHING YOU NEED</span>
        <p>
          Open from 7am to 10pm daily with easy access, quality surfaces, and a
          friendly place to play.
        </p>
      </section>
    </main>
  );
}
