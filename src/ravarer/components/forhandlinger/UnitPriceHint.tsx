import { useRawMaterialUnits } from "@/ravarer/hooks/useRawMaterialUnits";
import { formatNok } from "@/ravarer/lib/constants";

interface Props {
  rawMaterialId: string | null | undefined;
  /** Pris per baseenhet (kr). */
  pricePerBase: number | null | undefined;
  baseUnit: string | null | undefined;
}

/**
 * Viser en pris omregnet til baseenhet og til varens standard innkjøpsenhet,
 * slik at tilbud i «kr per kartong» kan sammenlignes med kostpris per stk.
 */
export function UnitPriceHint({ rawMaterialId, pricePerBase, baseUnit }: Props) {
  const { data: units = [] } = useRawMaterialUnits(rawMaterialId ?? undefined);
  if (pricePerBase == null || !Number.isFinite(Number(pricePerBase))) return null;

  const preferred = units.find(u => u.is_default_purchase) ?? units.find(u => u.is_sales_unit) ?? null;
  const factor = preferred ? Number(preferred.units_in_base) || 0 : 0;

  return (
    <span className="text-xs text-ink-secondary">
      {formatNok(Number(pricePerBase))}/{baseUnit ?? "enhet"}
      {preferred && factor > 0 && (
        <> · {formatNok(Number(pricePerBase) * factor)}/{preferred.unit_label}</>
      )}
    </span>
  );
}
