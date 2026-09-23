import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookingSummary } from "../../components/booking/BookingSummary";
import { TimeSlot } from "../../components/booking/TimeSlot";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { Modal } from "../../components/common/Modal";
import { QrCode } from "../../components/qr/QrCode";
import { courtService } from "../../services/courtService";
import { facilityService } from "../../services/facilityService";
import { guestBookingService } from "../../services/guestBookingService";
import { subscriptionService } from "../../services/subscriptionService";
import { formatCurrency } from "../../utils/currencyUtils";
import { formatTimeRange12, todayISO } from "../../utils/dateUtils";
import { useAuth } from "../../hooks/useAuth";
import { useRealtimeBookings } from "../../hooks/useRealtimeBookings";
import { useScrollReveal } from "../../hooks/useScrollReveal";

/**
 * True when every hour from `time` through `time + hours - 1` is open on this
 * court. Multi-hour bookings must span consecutive open hours — the database
 * rejects overlapping bookings (same rule as the signed-in booking page).
 */
function rangeFits(court, time, hours) {
  if (!court || !time) return true;
  const slots = court.slots || [];
  const start = Number(String(time).slice(0, 2));
  for (let offset = 0; offset < hours; offset += 1) {
    const key = `${String(start + offset).padStart(2, "0")}:00`;
    const found = slots.find((item) => item.time === key);
    if (!found || !found.available) return false;
  }
  return true;
}

/**
 * "Book a Court" for the public site — guest booking with no login and no
 * account. Rendered inline on the landing page (<GuestBooking embedded />) and
 * as a standalone page at /book-court.
 *
 * Everything that matters is enforced server-side by the guest RPCs in
 * supabase/migrations/0015_guest_bookings.sql: slot validation, pricing from
 * the court record, past-slot rejection and double-booking prevention.
 */
export function GuestBooking({ embedded = false }) {
  const { user } = useAuth();
  useScrollReveal();
  const [date, setDate] = useState(todayISO);
  const [courts, setCourts] = useState([]);
  const [selected, setSelected] = useState({});
  const [duration, setDuration] = useState(1);
  const [maxDuration, setMaxDuration] = useState(2);
  const [details, setDetails] = useState({ name: "", phone: "" });
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const canvasStore = useRef({});

  const load = async (targetDate) => {
    setLoadError("");
    try {
      const [nextCourts, facility] = await Promise.all([
        courtService.getAvailability(targetDate),
        facilityService.getPublicInfo().catch(() => null),
      ]);
      setCourts(nextCourts);
      if (facility) {
        const max = Number(facility.maxDuration) || 2;
        setMaxDuration(max);
        setDuration((current) =>
          current && current <= max ? current : Number(facility.defaultDuration) || 1,
        );
      }
    } catch (err) {
      setLoadError(err.message || "Could not load availability. Try again.");
    }
  };

  useEffect(() => {
    load(date);
    setSelected({});
  }, [date]);

  // Same live board as the rest of the public site: a booking made anywhere
  // refreshes the open slots here.
  useRealtimeBookings(() => load(date), Boolean(date));

  // Drop a selection that is no longer open (or no longer fits the duration).
  useEffect(() => {
    if (!selected.courtId || !selected.time) return;
    const court = courts.find((item) => item.id === selected.courtId);
    const slot = court?.slots?.find((item) => item.time === selected.time);
    if (!slot || !slot.available || !rangeFits(court, selected.time, duration)) {
      setSelected({});
    }
  }, [courts, selected, duration]);

  const selectedCourt = courts.find((court) => court.id === selected.courtId);
  const durationOptions = Array.from(
    { length: Math.max(1, Math.min(4, maxDuration)) },
    (_, index) => index + 1,
  );
  const hourlyRate = selectedCourt?.price || 300;
  const booking =
    selectedCourt && selected.time
      ? {
          courtId: selectedCourt.id,
          courtName: selectedCourt.name,
          date,
          time: selected.time,
          duration,
          amount: hourlyRate * duration,
        }
      : { date, duration };

  const openConfirm = async () => {
    if (!selectedCourt || !selected.time) return;
    setFormError("");
    setConfirming(true);
    // Freshen the grid so the guest sees it straight away if the slot went
    // while they were deciding (the server rejects it either way).
    await load(date);
  };

  const handleConfirm = async () => {
    if (!selectedCourt || !selected.time) return;
    if (details.name.trim().length < 2) {
      setFormError("Please enter the name for this booking.");
      return;
    }
    if (details.phone.replace(/\D/g, "").length < 7) {
      setFormError("Please enter a valid mobile number.");
      return;
    }
    setCreating(true);
    setFormError("");
    try {
      const created = await guestBookingService.createGuestBooking({
        courtId: selectedCourt.id,
        date,
        time: selected.time,
        duration,
        name: details.name.trim(),
        phone: details.phone.trim(),
      });
      setConfirmation(created);
      setConfirming(false);
      setSelected({});
      setDetails({ name: "", phone: "" });
      await load(date);
    } catch (err) {
      setFormError(
        subscriptionService.customerSubscriptionMessage(
          err,
          "Could not confirm your booking. Please try again.",
        ),
      );
    } finally {
      setCreating(false);
    }
  };

  const downloadQr = () => {
    const canvas = canvasStore.current[confirmation?.reference];
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${confirmation.reference}-qr.png`;
    link.click();
  };

  const reset = () => {
    canvasStore.current = {};
    setConfirmation(null);
    setFormError("");
  };

  const managePath = confirmation
    ? `/booking/${confirmation.reference}${
        confirmation.token ? `?t=${confirmation.token}` : ""
      }`
    : "/booking";
  const qrValue = confirmation
    ? guestBookingService.bookingManageUrl(
        confirmation.reference,
        confirmation.token,
      )
    : "";
  const createAccountPath = confirmation
    ? `/register?${new URLSearchParams({
        fullName: confirmation.customerName,
        phone: confirmation.customerPhone,
        next: managePath,
      }).toString()}`
    : "/register";

  const section = (
    <>
      <div className="guest-booking-heading">
        <span className="eyebrow">BOOK A COURT</span>
        <h2>
          Pick your hour.
          <br />
          <em>Play today.</em>
        </h2>
        <p>
          No account, no queue. Choose a date and an open hour, leave your name
          and mobile number, and we generate your booking reference and QR code
          straight away.
        </p>
      </div>

      {user ? (
        <div className="guest-booking-note">
          <div>
            <strong>You are signed in as {user.fullName}.</strong>
            <p>
              Keep every reservation in one place — book from your dashboard so
              this hour stays in your booking history.
            </p>
          </div>
          <Button to="/book">
            Book from my dashboard <span aria-hidden="true">-&gt;</span>
          </Button>
        </div>
      ) : confirmation ? (
        <div className="guest-booking-confirmation">
          <div className="confirmation-copy">
            <span className="eyebrow">BOOKING CONFIRMED</span>
            <h3>You are on court.</h3>
            <p>
              Keep your booking reference and QR code. They open this booking so
              you can check it or cancel it anytime — no login needed.
            </p>
            <div className="booking-reference">
              <small>Booking reference</small>
              <strong>{confirmation.reference}</strong>
            </div>
            <div className="summary-row">
              <span>Court</span>
              <strong>{confirmation.courtName}</strong>
            </div>
            <div className="summary-row">
              <span>Date</span>
              <strong>{confirmation.date}</strong>
            </div>
            <div className="summary-row">
              <span>Time</span>
              <strong>
                {formatTimeRange12(confirmation.time, confirmation.duration)}
              </strong>
            </div>
            <div className="summary-row">
              <span>Guest</span>
              <strong>
                {confirmation.customerName} · {confirmation.customerPhone}
              </strong>
            </div>
            <div className="summary-row">
              <span>Payment</span>
              <strong>
                Pay at court · {formatCurrency(confirmation.amount)}
              </strong>
            </div>
            <div className="confirmation-actions">
              <Button to={managePath}>
                View or manage booking <span aria-hidden="true">-&gt;</span>
              </Button>
              <button className="button outline" type="button" onClick={reset}>
                Book another court
              </button>
            </div>
            <div className="create-account-cta">
              <div>
                <strong>Want faster bookings next time?</strong>
                <p>
                  Create an account with the same details and this booking — plus
                  everything you book next — lands in your booking history.
                </p>
              </div>
              <Link className="text-link" to={createAccountPath}>
                Create an account
              </Link>
            </div>
          </div>
          <figure className="booking-qr">
            <QrCode
              value={qrValue}
              size={190}
              canvasStore={canvasStore}
              storeKey={confirmation.reference}
              className="booking-qr-canvas"
            />
            <figcaption>Scan to view or manage this booking</figcaption>
            <button className="button outline" type="button" onClick={downloadQr}>
              Download QR code
            </button>
            <small>
              Anyone with this QR code can open the booking, so keep it private.
              Show it at the front desk when you arrive.
            </small>
          </figure>
        </div>
      ) : (
        <>
          {loadError && (
            <div className="admin-load-row">
              <ErrorMessage message={loadError} />
              <button
                className="button outline"
                type="button"
                onClick={() => load(date)}>
                Try again
              </button>
            </div>
          )}
          <div className="book-layout">
            <section className="booking-picker">
              <label className="date-field">
                Choose a date
                <input
                  type="date"
                  min={todayISO()}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className="duration-field">
                Duration
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}>
                  {durationOptions.map((hours) => (
                    <option key={hours} value={hours}>
                      {hours} hour{hours > 1 ? "s" : ""} ·{" "}
                      {formatCurrency(hourlyRate * hours)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="booking-courts">
                {courts.length === 0 && !loadError && (
                  <p className="loading-state">Loading open hours…</p>
                )}
                {courts.map((court) => (
                  <div
                    className={`court-option ${
                      selected.courtId === court.id ? "selected" : ""
                    }`}
                    key={court.id}
                    onClick={() => setSelected({ courtId: court.id })}>
                    <div className="court-option-header">
                      <strong>{court.name}</strong>
                      <span>
                        {selected.courtId === court.id
                          ? "Selected"
                          : "Select court"}
                      </span>
                    </div>
                    <div className="slot-grid">
                      {court.slots.map((slot) => {
                        const fits = rangeFits(court, slot.time, duration);
                        const selectable = slot.available && fits;
                        return (
                          <TimeSlot
                            key={slot.time}
                            {...slot}
                            selected={
                              selected.courtId === court.id &&
                              selected.time === slot.time
                            }
                            hint={
                              slot.available && !fits
                                ? `Not available for ${duration} hour${
                                    duration > 1 ? "s" : ""
                                  } — the next hour is taken`
                                : ""
                            }
                            onClick={
                              selectable
                                ? (event) => {
                                    event.stopPropagation();
                                    setSelected({
                                      courtId: court.id,
                                      time: slot.time,
                                    });
                                  }
                                : undefined
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <BookingSummary booking={booking} onContinue={openConfirm} />
          </div>
        </>
      )}

      {confirming && selectedCourt && selected.time && (
        <Modal title="Confirm your booking" onClose={() => setConfirming(false)}>
          <div className="form-card modal-form">
            <div className="summary-row">
              <span>Court</span>
              <strong>{selectedCourt.name}</strong>
            </div>
            <div className="summary-row">
              <span>Date</span>
              <strong>{date}</strong>
            </div>
            <div className="summary-row">
              <span>Time</span>
              <strong>{formatTimeRange12(selected.time, duration)}</strong>
            </div>
            <div className="summary-total">
              <span>Total</span>
              <strong>{formatCurrency(hourlyRate * duration)}</strong>
            </div>
            <label>
              Your name
              <input
                value={details.name}
                onChange={(event) =>
                  setDetails({ ...details, name: event.target.value })
                }
                placeholder="Juan Dela Cruz"
                autoComplete="name"
              />
            </label>
            <label>
              Mobile number
              <input
                value={details.phone}
                onChange={(event) =>
                  setDetails({ ...details, phone: event.target.value })
                }
                placeholder="0917 555 0188"
                inputMode="tel"
                autoComplete="tel"
              />
            </label>
            <p className="guest-booking-hint">
              No account needed. We only use your number if the facility has to
              reach you about this booking.
            </p>
            {formError && <ErrorMessage message={formError} />}
            <button
              className="button full-width"
              type="button"
              disabled={creating}
              onClick={handleConfirm}>
              {creating ? "Booking..." : "Confirm booking"}{" "}
              <span aria-hidden="true">-&gt;</span>
            </button>
          </div>
        </Modal>
      )}
    </>
  );

  if (embedded) {
    return (
      <section className="guest-booking reveal" id="book">
        {section}
      </section>
    );
  }

  return (
    <main className="page-wrap guest-booking-page">
      <div className="page-intro compact">
        <span className="eyebrow">RESERVE YOUR HOUR</span>
        <h1>
          Book a <em>court.</em>
        </h1>
        <p>
          Guest booking, no account needed. Pick a date, choose an open hour and
          confirm with your name and mobile number.
        </p>
      </div>
      <section className="guest-booking">{section}</section>
    </main>
  );
}
