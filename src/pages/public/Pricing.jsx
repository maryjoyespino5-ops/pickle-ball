import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/common/Button";
import { facilityService } from "../../services/facilityService";
import { formatCurrency } from "../../utils/currencyUtils";

export function Pricing() {
  const [rate, setRate] = useState(300);
  const [hours, setHours] = useState({ opening: "07:00", closing: "22:00" });

  useEffect(() => {
    let mounted = true;
    facilityService
      .getPublicInfo()
      .then((info) => {
        if (!mounted || !info) return;
        if (info.minPrice) setRate(info.minPrice);
        if (info.opening && info.closing)
          setHours({ opening: info.opening, closing: info.closing });
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <main className="page-wrap pricing-page">
      <div className="page-intro compact">
        <span className="eyebrow">KEEP IT SIMPLE</span>
        <h1>
          One rate.
          <br />
          <em>Zero surprises.</em>
        </h1>
        <p>
          Everything you need for a great hour on court, without the complicated
          math.
        </p>
      </div>
      <div className="price-card">
        <div>
          <span className="eyebrow">COURT TIME</span>
          <h2>
            {formatCurrency(rate)}
            <small>/ hour</small>
          </h2>
          <p>Per pickleball court, for up to 4 players.</p>
        </div>
        <ul>
          <li>Professional court surface</li>
          <li>
            Open daily, {hours.opening} - {hours.closing}
          </li>
          <li>Instant booking confirmation</li>
        </ul>
        <Button to="/book">
          Book your hour <span aria-hidden="true">-&gt;</span>
        </Button>
      </div>
      <p className="fine-print">
        Need to change plans? Cancel up to 2 hours before your booking.{" "}
        <Link to="/contact">Questions? Talk to us.</Link>
      </p>
    </main>
  );
}
