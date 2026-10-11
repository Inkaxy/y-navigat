/** Felles avviksregel for varelisten og råvarekortets forrige/neste — samme predikat, aldri en kopi. */
import { isLargeDeviation } from "@/ravarer/components/vareliste/PriceCells";
import type { DeviationRule } from "@/ravarer/lib/rawMaterialViews";

export function deviationRuleFor(toleranceFor: (category?: string | null) => number, hardCap: number): DeviationRule {
  return (i) => isLargeDeviation(i.deviation, toleranceFor(i.categories[0]), hardCap);
}
