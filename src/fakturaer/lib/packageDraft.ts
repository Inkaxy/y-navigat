import { pickPackageRow } from "@/fakturaer/lib/packageSignature";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import { deriveLinePackage, normalizeUnit, parseDecimal, parsePackageFromDescription, toBaseFactor } from "@/fakturaer/lib/units";

export interface SupplierPackageLink {
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package?: number | null;
  package_confirmed_at?: string | null;
  supplier_sku?: string | null;
}

/**
 * Leverandørkoblingen som gjelder linjen — samme regel som matchemotoren
 * (packageSignature.ts). Flere rader med ulik pakning gir undefined.
 */
export function pickSupplierLink<T extends SupplierPackageLink>(rows: T[], sku: string | null): T | undefined {
  return pickPackageRow(rows, sku).row;
}

/** Bekreftet innhold per pakning i grunnenheten, om koblingen har det. */
export function confirmedBaseUnits(link: SupplierPackageLink | null | undefined): number | null {
  const n = Number(link?.base_units_per_package);
  return link?.package_confirmed_at && Number.isFinite(n) && n > 0 ? n : null;
}
/** Pakningsutkastet slik brukeren har skrevet det, tolket mot råvarens grunnenhet. */
export type PackageDraft =
  | { state: "empty" }
  | { state: "invalid"; reason: string }
  | { state: "valid"; size: number; unit: string; baseUnitsPerPackage: number };

/** Tolk utkastet. Bare positive tall i en enhet som kan regnes om til grunnenheten godtas. */
export function readPackageDraft(sizeText: string, unitText: string, baseUnit: string | null | undefined): PackageDraft {
  if (!sizeText.trim()) return { state: "empty" };
  const base = normalizeUnit(baseUnit);
  if (!base) return { state: "invalid", reason: "Råvaren mangler grunnenhet, så pakningen kan ikke regnes om." };
  const size = parseDecimal(sizeText);
  if (size == null || !Number.isFinite(size) || size <= 0) return { state: "invalid", reason: "Skriv et positivt tall." };
  const unit = normalizeUnit(unitText || base);
  const factor = unit ? toBaseFactor(unit, base) : null;
  if (!unit || factor == null) {
    return { state: "invalid", reason: `${unitText || "Enheten"} kan ikke regnes om til ${base} uten et produktspesifikt grunnlag.` };
  }
  return { state: "valid", size, unit, baseUnitsPerPackage: size * factor };
}

/**
 * Forslag til pakningsutkast i råvarens grunnenhet. For «stk» er forslaget
 * ANTALLET (36 i «36X90G») — vekten per stk er aldri et antall.
 */
export function suggestPackage(
  line: Pick<ReviewLineRow, "package_size" | "package_unit" | "count_per_package" | "description">,
  baseUnit: string | null | undefined,
  link?: SupplierPackageLink | null,
): { size: string; unit: string } {
  const base = normalizeUnit(baseUnit);
  if (!base) return { size: "", unit: "" };
  // Bekreftet leverandørpakning gjenbrukes — den skal ikke tastes på nytt hver faktura.
  const confirmed = confirmedBaseUnits(link);
  if (confirmed != null) return { size: String(confirmed), unit: base };
  if (base === "stk") {
    const parsed = parsePackageFromDescription(line.description);
    const cnt = Number(line.count_per_package) > 0 ? Number(line.count_per_package) : parsed?.unit === "stk" ? parsed.size * (parsed.count || 1) : parsed?.count ?? null;
    return cnt && cnt > 0 ? { size: String(cnt), unit: "stk" } : { size: "", unit: "stk" };
  }
  const pkg = deriveLinePackage(line);
  if (pkg && toBaseFactor(pkg.unit, base) != null) return { size: String(pkg.size), unit: pkg.unit };
  if (link?.package_size != null && link.package_size > 0 && toBaseFactor(link.package_unit, base) != null) {
    return { size: String(link.package_size), unit: normalizeUnit(link.package_unit) ?? base };
  }
  return { size: "", unit: base };
}


/**
 * Konkret uenighet mellom bekreftet leverandørpakning og det varenavnet tyder på.
 * Varenavnet er bare et forslag; uenigheten vises, men overstyrer ingenting.
 */
export function packageDisagreement(
  line: Pick<ReviewLineRow, "package_size" | "package_unit" | "count_per_package" | "description">,
  baseUnit: string,
  link: SupplierPackageLink | null,
): string | null {
  const confirmed = confirmedBaseUnits(link);
  if (confirmed == null) return null;
  const fromText = suggestPackage(line, baseUnit, null);
  const base = normalizeUnit(baseUnit);
  const n = parseDecimal(fromText.size);
  if (n == null || !base) return null;
  const factor = toBaseFactor(normalizeUnit(fromText.unit) ?? base, base);
  if (factor == null) return null;
  const textBase = n * factor;
  if (Math.abs(textBase - confirmed) < 1e-9) return null;
  const fmt = (v: number) => v.toLocaleString("nb-NO", { maximumFractionDigits: 3 });
  return `Bekreftet pakning er ${fmt(confirmed)} ${base}, men varenavnet tyder på ${fmt(textBase)} ${base}. Kontroller før du bekrefter.`;
}
