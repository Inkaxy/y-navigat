import { getLifecycleMeta } from "@/ordre/lib/orderStatus";
import { StatusPill } from "@/ordre/components/ui/status-pill";

/**
 * LifecycleBadge — utledet livssyklus (orders_lifecycle).
 * Viser pakkseddelnummer når livssyklusen er 'delivery_note'.
 */
export function LifecycleBadge({
  lifecycle,
  deliveryNoteNumber,
  size = "sm",
  className,
}: {
  lifecycle: string | null | undefined;
  deliveryNoteNumber?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = getLifecycleMeta(lifecycle);
  const label =
    lifecycle === "delivery_note"
      ? `Pakkseddel${deliveryNoteNumber ? ` ${deliveryNoteNumber}` : ""}`
      : meta.label;
  return (
    <StatusPill
      label={label}
      tokenVar={meta.tokenVar}
      size={size}
      strikethrough={lifecycle === "cancelled"}
      className={className}
    />
  );
}
