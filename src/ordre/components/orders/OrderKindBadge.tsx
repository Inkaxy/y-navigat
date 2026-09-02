import { getKindMeta } from "@/ordre/lib/orderStatus";
import { StatusPill } from "@/ordre/components/ui/status-pill";

/**
 * OrderKindBadge — Tedebes fargekoder for ordretype.
 * dated=grå/hvit · fixed=gul · repeating=grønn · extra=blå · return=rød · closed=grå
 */
export function OrderKindBadge({
  kind,
  size = "sm",
  className,
}: {
  kind: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const meta = getKindMeta(kind);
  return <StatusPill label={meta.label} tokenVar={meta.tokenVar} size={size} className={className} />;
}
