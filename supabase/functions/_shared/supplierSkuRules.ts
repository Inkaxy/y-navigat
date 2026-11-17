// Leverandørspesifikke regler for varenummerkolonnen. Bare for leverandører der vi har sett et fast mønster i
// lagrede linjer. Trykt varenummer forblir autoritativt; regelen fjerner bare en verdi som beviselig IKKE er et
// varenummer (sku settes til null, sku_raw beholdes som bevis), og gir leseren en presis instruks.
export interface SupplierSkuRule {
  /** Treffer leverandørnavnet fra regnskapssystemet. */
  supplier: RegExp;
  /** Instruks til leseren (legges i brukerteksten sammen med kontrollfakta). */
  hint: string;
  /** Råverdier i varenummerfeltet som ikke er varenummer. */
  notSku: RegExp;
}

export const SUPPLIER_SKU_RULES: readonly SupplierSkuRule[] = [
  {
    // ASKO: samme vare er lest som «29 9727», «299727», «9727» og «305-11» på ulike fakturaer. «305-N», «331-1» og
    // «305-1/1» skifter fra faktura til faktura for samme vare og deles av ulike varer – de er ikke varenummer.
    supplier: /\basko\b/i,
    hint:
      "ASKO-fakturaer: varenummeret er 6–7 sifre og er ofte trykt i to grupper med mellomrom («29 9727», «404 8468», «413 3690»). " +
      "Ta alltid med BEGGE gruppene i sku_raw og sku – aldri bare de fire siste sifrene. " +
      "Koder på formen «305-11», «305-5», «331-1» eller «305-1/1» er IKKE varenummer: bruk dem aldri som sku. " +
      "Finnes ikke noe annet varenummer på linjen, sett sku=null.",
    notSku: /^\d{3}\s*-\s*\d{1,2}(\s*\/\s*\d{1,2})?$/,
  },
];

export function supplierSkuRule(supplierName: string | null | undefined): SupplierSkuRule | null {
  const n = (supplierName ?? "").trim();
  if (!n) return null;
  return SUPPLIER_SKU_RULES.find((r) => r.supplier.test(n)) ?? null;
}

/** Fjerner varenummer som etter leverandørens regel ikke er varenummer. Endrer aldri et gyldig varenummer. */
export function applySupplierSkuRules<T extends { sku: string | null; sku_raw?: string | null }>(lines: readonly T[], supplierName: string | null | undefined): T[] {
  const rule = supplierSkuRule(supplierName);
  if (!rule) return [...lines];
  return lines.map((l) => (l.sku != null && rule.notSku.test(l.sku.trim()) ? { ...l, sku: null } : l));
}
