import { getStatusMeta } from "@/ordre/lib/orderStatus";
import { StatusPill } from "@/ordre/components/ui/status-pill";

/**
 * StatusBadge (ordre-domenet) — wrapper rundt delt <StatusPill>.
 * Mapper ordre-status → token + label + strikethrough for cancelled.
 */
export function StatusBadge({
  status,
  size = "sm",
  className,
}: {
  status: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = getStatusMeta(status);
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
