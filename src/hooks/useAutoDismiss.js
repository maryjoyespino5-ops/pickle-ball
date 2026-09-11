import { useEffect } from "react";

/**
 * Runs `onExpire` once, `wait` ms after `active` becomes truthy, then resets.
 * Used for success notices that should auto-dismiss (B30).
 */
export function useAutoDismiss(active, onExpire, wait = 4500) {
  useEffect(() => {
    if (!active) return undefined;
    if (typeof onExpire !== "function") return undefined;
    const timer = setTimeout(() => onExpire(), wait);
    return () => clearTimeout(timer);
  }, [active, onExpire, wait]);
}