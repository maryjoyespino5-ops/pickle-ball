import { CourtCard } from "../../components/courts/CourtCard";
import { COURTS } from "../../lib/constants";
export function Courts() {
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
      <div className="court-grid">
        {COURTS.map((court) => (
          <CourtCard key={court.id} court={court} />
        ))}
      </div>
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
