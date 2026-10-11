import { parseDecimal } from "@/ravarer/lib/packageMath";

/**
 * Avledet pris per grunnenhet fra gjeldende input. Tom streng når input er ugyldig/ufullstendig,
 * slik at en tidligere beregnet verdi aldri blir stående som «gjeldende».
 */
export function derivePricePerBaseUnit(agreedPrice: string, basis: "package" | "base", unitsPerPackage: number | null): string {
  const ap = parseDecimal(agreedPrice);
  if (ap == null || !(ap > 0)) return "";
  if (basis === "base") return String(ap);
  if (unitsPerPackage == null || !(unitsPerPackage > 0)) return "";
  return (ap / unitsPerPackage).toFixed(4);
}

/** Skjemavalidering før dokumentopplasting og RPC. */
export function agreementFormError(f: { agreedPrice: string; pricePerBaseUnit: string; validFrom: string; validTo: string }): string | null {
  const ap = parseDecimal(f.agreedPrice);
  if (ap == null || !(ap > 0)) return "Oppgi en gyldig avtalepris";
  if (f.pricePerBaseUnit.trim()) {
    const ppbu = parseDecimal(f.pricePerBaseUnit);
    if (ppbu == null || !(ppbu > 0)) return "Pris per grunnenhet er ugyldig";
  }
  if (f.validFrom && f.validTo && f.validTo < f.validFrom) return "Sluttdato kan ikke være før startdato";
  return null;
}
