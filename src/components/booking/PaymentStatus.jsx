/**
 * The payment STATUS pill: pending / paid / refunded.
 *
 * Deliberately says nothing about the METHOD. The method used to be bolted on
 * here as a "Paid · GCash" badge, but every view that renders this already has
 * (or now gets) its own "Payment method" column — so the badge was pure
 * redundancy, repeating a value one cell away.
 *
 * Money and method are two independent facts and they get two columns:
 *
 *   Payment status    pending | paid | refunded   (did the money settle?)
 *   Payment method    GCash | Pay at Court       (how did it settle?)
 *
 * A paid booking is therefore "paid" + "GCash" rather than one crowded
 * "Paid · GCash" cell, which also keeps the status column sortable and
 * scannable.
 */
export function PaymentStatus({ paymentStatus }) {
  return (
    <span className={`status status-${paymentStatus}`}>{paymentStatus}</span>
  );
}
