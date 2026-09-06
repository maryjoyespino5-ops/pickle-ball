import { Link } from "react-router-dom";
import { formatCurrency } from "../../utils/currencyUtils";
import { HOURLY_RATE } from "../../lib/constants";
export function CourtCard({ court }) {
  return (
    <article className={`court-card ${court.accent}`}>
      <div className="court-card-art">
        <span className="court-net" aria-hidden="true" />
        <span className="court-ball" aria-hidden="true" />
        <span className="court-badge">AVAILABLE</span>
        <span className="court-number">
          {court.name.replace("Court ", "0")}
        </span>
      </div>
      <div className="court-card-content">
        <div>
          <span className="eyebrow">PICKLEBALL COURT</span>
          <h3>{court.name}</h3>
          <p>{court.description}</p>
        </div>
        <div className="court-card-footer">
          <strong>
            {formatCurrency(court.price || HOURLY_RATE)}
            <small>/ hour</small>
          </strong>
          <Link className="arrow-link" to="/book">
            Book <span aria-hidden="true">-&gt;</span>
          </Link>
        </div>
      </div>
    </article>
  );
}
