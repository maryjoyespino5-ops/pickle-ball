import { PAYMENT_STATUSES } from "../../lib/constants";

/**
 * The one place that decides how a settled payment is worded.
 *
 * A paid booking can be paid two genuinely different ways, and the player and
 * the owner both need to know which one happened:
 *
 *   "Paid · GCash"         the player paid online; PayMongo's verified webhook
 *                          (or paymongo-verify) settled it. No cash at the desk.
 *   "Paid · Pay at Court"  an admin recorded cash handed over at the facility.
 *
 * Showing only the bare word "paid" hides that distinction, which is exactly
 * the question an owner asks when reconciling the day's takings. Anything that
 * is not paid is rendered as its plain status (pending / refunded) with no
 * method claim, because nothing has been collected yet.
 *
 * @param {object} props
 * @param {string} props.paymentStatus  'pending' | 'paid' | 'refunded'
 * @param {string} [props.paymentMethod] the settled method, e.g. 'GCash'
 * @param {boolean} [withBadge] render the "Paid · <method>" line as well as the
 *   status pill. The status pill is always shown so the column still scans as
 *   a status column.
 */
export function PaymentStatus({ paymentStatus, paymentMethod, withBadge = true }) {
  const isPaid = paymentStatus === PAYMENT_STATUSES.PAID;
  const method = String(paymentMethod || "").trim();
  return (
    <>
      <span className={`status status-${paymentStatus}`}>{paymentStatus}</span>
      {isPaid && withBadge && (
        <>
          <br />
          <small className="payment-status paid-confirmed-badge">
            Paid
            {method ? ` · ${method}` : ""}
          </small>
        </>
      )}
    </>
  );
}
