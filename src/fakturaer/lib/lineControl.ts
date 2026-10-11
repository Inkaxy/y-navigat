import { resolveLineCost, type ResolveLineCostResult } from "@/fakturaer/lib/units";
import type { ReviewLineRow } from "@/fakturaer/hooks/useReviewLines";
import type { SupplierLinkRow } from "@/fakturaer/hooks/useSupplierLinkContext";
import { allReasons, reasonLabel } from "@/fakturaer/lib/reviewReasons";

/** Kort tekst for hvilken råvare linjen peker på — skiller bekreftet kobling fra forslag. */
export function materialSummary(line: ReviewLineRow): string {
  if (line.match_confidence === "not_applicable") return "Ikke vare";
  if (line.matched_raw_material) return line.matched_raw_material.name;
  const top = line.suggestions?.[0]?.raw_material?.name;
  return top ? `Forslag: ${top}` : "Ingen råvare valgt";
}

const PACKAGE_CODES = new Set(["unknown_package_size", "missing_base_unit", "uncertain_cost", "zero_quantity", "extraction_unresolved", "extraction_issue"]);
const PRICE_CODES = new Set([
  "price_variance",
  "price_increase",
  "price_drop",
  "agreement_conflict",
  "no_baseline",
  "price_reference_error",
  "unsupported_currency",
  "no_automatic_basis",
  "start_price_manual_check",
  "recalculation_pending",
]);

export function reasonsIn(line: ReviewLineRow, group: "package" | "price"): string[] {
  const set = group === "package" ? PACKAGE_CODES : PRICE_CODES;
  return allReasons(line).filter((r) => set.has(r)).map(reasonLabel);
}

export function baseUnitOf(line: ReviewLineRow, link: SupplierLinkRow | null): string | null {
  return line.matched_raw_material?.base_unit ?? link?.raw_material?.base_unit ?? line.suggestions?.[0]?.raw_material?.base_unit ?? null;
}

/** Samme beregning som køen alltid har brukt — kun for visning av regnestykket. */
export function costOf(line: ReviewLineRow, link: SupplierLinkRow | null): ResolveLineCostResult | null {
  const baseUnit = baseUnitOf(line, link);
  if (!baseUnit) return null;
  return resolveLineCost({
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unit_price,
    totalAmount: line.total_amount,
    packageSize: line.package_size,
    packageUnit: line.package_unit,
    countPerPackage: line.count_per_package,
    description: line.description,
    baseUnit,
    supplierPackage: link
      ? {
          baseUnitsPerPackage: link.base_units_per_package,
          packageSize: link.package_size,
          packageUnit: link.package_unit,
          packageConfirmedAt: link.package_confirmed_at,
        }
      : null,
  });
}

