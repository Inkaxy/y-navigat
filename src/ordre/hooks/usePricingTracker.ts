import { useEffect, useRef, useState } from "react";
import { PricingRequestTracker, type PricingStatus } from "@/ordre/lib/pricingRequestState";

/**
 * Livsløpet til prisoppslagene i kundeordreskjemaet.
 *
 * Skjemaet gjenbrukes for flere ordrer og kunder. Et prisoppslag som fortsatt
 * er i luften når skjemaet lukkes — eller når det åpnes for en annen ordre
 * eller kunde — må forkastes, ellers kan svaret skrive prisene sine inn i
 * NESTE ordre.
 */
export function usePricingTracker(scope: {
  open: boolean;
  orderId: string | null;
  customerId: string;
}): {
  tracker: PricingRequestTracker;
  status: PricingStatus;
  setStatus: (s: PricingStatus) => void;
} {
  const trackerRef = useRef(new PricingRequestTracker());
  const [status, setStatus] = useState<PricingStatus>({ pending: false, failed: false });

  useEffect(() => {
    const tracker = trackerRef.current;
    tracker.invalidate();
    setStatus(tracker.status());
    return () => {
      tracker.invalidate();
    };
  }, [scope.open, scope.orderId, scope.customerId]);

  return { tracker: trackerRef.current, status, setStatus };
}
