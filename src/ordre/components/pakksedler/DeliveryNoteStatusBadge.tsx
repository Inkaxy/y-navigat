import { getDeliveryNoteStatusMeta } from "@/ordre/lib/deliveryNoteStatus";
import { StatusPill } from "@/components/ui/status-pill";

/**
 * DeliveryNoteStatusBadge — wrapper rundt delt <StatusPill>.
 * Egen komponent (ikke union med ordre-StatusBadge) fordi status-settet
 * er fundamentalt forskjellig — men deler visuell primitiv for konsistens.
 */
export function DeliveryNoteStatusBadge({
  status,
  size = "sm",
  className,
}: {
  status: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = getDeliveryNoteStatusMeta(status);
  const isCancelled = status === "cancelled";
  return (
    <StatusPill
      label={meta.label}
      tokenVar={meta.tokenVar}
      size={size}
      strikethrough={isCancelled}
      className={className}
    />
  );
}
