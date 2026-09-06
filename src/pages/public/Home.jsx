import { Link } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { CourtCard } from "../../components/courts/CourtCard";
import { COURTS, HOURLY_RATE } from "../../lib/constants";
import { formatCurrency } from "../../utils/currencyUtils";

export function Home() {
  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">YOUR NEXT RALLY STARTS HERE</span>
          <h1>
            Make time
            <br />
            <em>to play.</em>
          </h1>
          <p>
            Two beautifully kept courts. Easy online booking. More time doing
            what you love.
          </p>
          <div className="hero-actions">
            <Button to="/book">
              Book a court <span aria-hidden="true">-&gt;</span>
            </Button>
            <Link className="text-link" to="/availability">
              Check availability
            </Link>
          </div>
        </div>
        <div className="hero-art">
          <div className="court-lines">
            <span className="net" />
            <span className="ball">•</span>
          </div>
          <p>
            OPEN DAILY
            <br />
            <strong>07:00 - 22:00</strong>
          </p>
        </div>
      </section>
      <section className="intro-section">
        <div>
          <span className="section-index">01 / THE CLUB</span>
          <h2>
            Good games start
            <br />
            with a good court.
          </h2>
        </div>
        <p>
          Rally Court Club is a simple place for people who love the game. Pick
          a time, bring your crew, and get straight to the fun. No fuss, no
          waiting around.
        </p>
      </section>
      <section className="home-section" id="courts">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THE COURTS</span>
            <h2>
              Find your next
              <br />
              <em>favorite court.</em>
            </h2>
          </div>
          <Link className="arrow-link" to="/courts">
            View all courts <span aria-hidden="true">-&gt;</span>
          </Link>
        </div>
        <div className="court-grid">
          {COURTS.map((court) => (
            <CourtCard key={court.id} court={court} />
          ))}
        </div>
      </section>
      <section className="availability-preview">
        <div>
          <span className="eyebrow">LIVE AVAILABILITY</span>
          <h2>
            There is always
            <br />
            room for one more.
          </h2>
          <p>
            See open times across both courts and book your hour in a few taps.
          </p>
          <Button to="/availability" variant="light">
            See availability <span aria-hidden="true">-&gt;</span>
          </Button>
        </div>
        <div className="availability-mini">
          <div className="mini-head">
            <strong>Today</strong>
            <span>September 18, 2026</span>
          </div>
          <div className="mini-row">
            <span>Court 1</span>
            <b>08:00</b>
            <b className="booked">14:00</b>
            <b>16:00</b>
            <b>19:00</b>
          </div>
          <div className="mini-row">
            <span>Court 2</span>
            <b>08:00</b>
            <b>10:00</b>
            <b className="booked">16:00</b>
            <b>20:00</b>
          </div>
          <small>
            <i className="dot open" /> Open <i className="dot taken" /> Booked
          </small>
        </div>
      </section>
      <section className="pricing-teaser" id="pricing">
        <span className="eyebrow">SIMPLE PRICING</span>
        <h2>
          One great hour.
          <br />
          <em>One honest price.</em>
        </h2>
        <p>Every court, every day, same simple rate.</p>
        <strong>
          {formatCurrency(HOURLY_RATE)} <small>/ hour</small>
        </strong>
        <Link className="text-link" to="/pricing">
          See pricing details
        </Link>
      </section>
    </main>
  );
}
