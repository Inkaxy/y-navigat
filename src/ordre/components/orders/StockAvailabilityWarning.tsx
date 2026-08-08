import { AlertTriangle } from "lucide-react";
import { useResaleAvailability } from "@/ordre/hooks/useResaleAvailability";

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(n);

/**
 * Rolig advarsel når antallet på en ordrelinje overstiger disponibelt lager.
 * Blokkerer aldri — det kommer ofte en leveranse i morgen.
 */
export function StockAvailabilityWarning({
  productId,
  quantity,
  className = "",
}: {
  productId: string | null | undefined;
  quantity: number;
  className?: string;
}) {
  const { data } = useResaleAvailability(productId ? [productId] : []);
  const info = productId ? data?.get(productId) : undefined;
  if (!info || quantity <= info.available_sold_units) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-warning ${className}`}
      title={`Disponibelt = beholdning minus det som allerede er bestilt av kunder (${info.raw_material_name}).`}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      Disponibelt: {fmt(info.available_sold_units)}. Bestilt her: {fmt(quantity)}.
    </span>
  );
}
