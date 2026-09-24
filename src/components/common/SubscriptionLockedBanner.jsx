import { Link } from "react-router-dom";
import { useSubscription } from "../../context/SubscriptionContext";
import { formatCurrency } from "../../utils/currencyUtils";
import { SUBSCRIPTION_FEE } from "../../services/subscriptionService";

/**
 * Read-only notice shown at the top of admin pages while the license is
 * expired. Rendered only when expired — active licenses show nothing.
 */
export function SubscriptionLockedBanner() {
  const { isActive, loading, subscription } = useSubscription();
  if (loading || isActive) return null;
  const fee = subscription?.monthlyFee ?? SUBSCRIPTION_FEE;
  return (
    <div className="renewal-banner renewal-banner-slim" role="alert">
      <p>
        <strong>License expired{subscription?.expiresAt ? ` on ${new Date(subscription.expiresAt).toLocaleDateString()}` : ""}.</strong>{" "}
        Records are read-only until you renew the {formatCurrency(fee)} monthly subscription.{" "}
        <Link to="/admin/subscription">Go to renewal</Link>
      </p>
    </div>
  );
}
