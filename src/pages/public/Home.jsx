import { HeroShowcase } from "../../components/common/HeroShowcase";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { Button } from "../../components/common/Button";
import { CourtCard } from "../../components/courts/CourtCard";
import { courtService } from "../../services/courtService";
import { facilityService } from "../../services/facilityService";
import { useCourts } from "../../hooks/useCourts";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { useRealtimeBookings } from "../../hooks/useRealtimeBookings";
import { useEffect, useState } from "react";
import { todayISO } from "../../utils/dateUtils";
import { formatCurrency } from "../../utils/currencyUtils";

export function Home() {
  const { courts, loading } = useCourts();
  const [availability, setAvailability] = useState([]);
  const [facility, setFacility] = useState(null);
  useScrollReveal();
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // B6: the "LIVE AVAILABILITY" panel reads today's real slots (no more
  // hardcoded demo values) and refreshes whenever a booking changes.
  const load = () => {
    courtService
      .getAvailability(todayISO())
      .then((rows) => setAvailability(rows))
      .catch(() => setAvailability([]));
    facilityService
      .getPublicInfo()
      .then((info) => setFacility(info))
      .catch(() => setFacility(null));
  };
  useEffect(() => {
    load();
  }, []);
  useRealtimeBookings(load, true);

  const preview = useMemo(
    () =>
      availability.slice(0, 2).map((court) => ({
        name: court.name,
        slots: (court.slots || [])
          .filter((slot) => slot.available)
          .slice(0, 4),
      })),
    [availability],
  );
  const heroRate = facility?.minPrice || courts[0]?.price || 300;
  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow">YOUR NEXT GAME STARTS HERE</span>
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
        <div className="hero-art hero-art--showcase">
          <HeroShowcase />
        </div>
      </section>
      <section className="intro-section reveal">
        <div>
          <span className="section-index">01 / THE CLUB</span>
          <h2>
            Good games start
            <br />
            with a good court.
          </h2>
        </div>
        <p>
          Alicayard Pickle Ball is a simple place for people who love the game. Pick
          a time, bring your crew, and get straight to the fun. No fuss, no
          waiting around.
        </p>
      </section>
      <section className="home-section reveal" id="courts">
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
          {loading ? (
            <p className="loading-state">Loading courts...</p>
          ) : courts.length === 0 ? (
            <p className="empty-panel">Courts are coming soon. Check back shortly!</p>
          ) : (
            courts.map((court) => <CourtCard key={court.id} court={court} />)
          )}
        </div>
      </section>
      <section className="availability-preview reveal">
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
            <span>{today}</span>
          </div>
          {preview.length === 0 ? (
            <div className="mini-row">
              <span>Loading live slots…</span>
            </div>
          ) : (
            preview.map((court) => (
              <div className="mini-row" key={court.name}>
                <span>{court.name}</span>
                {court.slots.length === 0 ? (
                  <b className="booked">Full</b>
                ) : (
                  court.slots.map((slot) => <b key={slot.time}>{slot.time}</b>)
                )}
              </div>
            ))
          )}
          <small>
            <i className="dot open" /> Open slots today <i className="dot taken" /> Full
          </small>
        </div>
      </section>
      <section className="pricing-teaser reveal" id="pricing">
        <span className="eyebrow">SIMPLE PRICING</span>
        <h2>
          One great hour.
          <br />
          <em>One honest price.</em>
        </h2>
        <p>Every court, every day, same simple rate.</p>
        <strong>
          {formatCurrency(heroRate)} <small>/ hour</small>
        </strong>
        <Link className="text-link" to="/pricing">
          See pricing details
        </Link>
      </section>
    </main>
  );
}
