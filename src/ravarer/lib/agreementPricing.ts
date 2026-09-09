import { toBaseFactor } from "@/fakturaer/lib/units";
import { parseDecimal } from "@/ravarer/lib/packageMath";

/**
 * Hvor mange grunnenheter én pakning inneholder i en leverandøravtale.
 *
 * Rekkefølgen er bevisst: et eksplisitt innhold («25 kg i sekken») vinner alltid
 * over pakningstallet, ellers ville «500 kr per 1 sekk» blitt 500 kr/kg i stedet
 * for 20 kr/kg. Er pakningsenheten ukjent (sekk, kolli), brukes pakningstallet
 * som det er.
 */
export function agreementBaseUnitsPerPackage(
  baseUnitsPerPackage: string | number | null | undefined,
  packageSize: string | number | null | undefined,
  packageUnit: string | null | undefined,
  baseUnit: string | null | undefined,
): number | null {
  const bupp = typeof baseUnitsPerPackage === "number" ? baseUnitsPerPackage : parseDecimal(baseUnitsPerPackage ?? "");
  if (bupp != null && bupp > 0) return bupp;

  const size = typeof packageSize === "number" ? packageSize : parseDecimal(packageSize ?? "");
  if (size == null || size <= 0) return null;

  const factor = toBaseFactor(packageUnit, baseUnit);
  return factor == null ? size : size * factor;
}
