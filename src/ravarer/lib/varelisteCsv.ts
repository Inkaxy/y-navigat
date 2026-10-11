import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import type { RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";
import { COST_STATUS_LABEL } from "@/ravarer/lib/listPriceEvidence";

/** «Faktura» / «Manuell» / «—» for `raw_materials.price_source`. */
export function priceSourceLabel(s: string | null | undefined): string {
  if (!s) return "—";
  if (s === "invoice" || s.startsWith("invoice")) return "Faktura";
  if (s === "manual") return "Manuell";
  return "—";
}

/** Én CSV-celle for en kolonne i varelisten. */
export function csvValue(colId: string, i: RawMaterialListItem): string {
  switch (colId) {
          case "sku":
            return i.sku;
          case "name":
            return i.name;
          case "category":
            return i.categories.join(", ");
          case "supplier":
            return i.supplierName ?? "";
          case "cost":
            // Status følger prisen i eksporten, så en ikke-verifisert kost aldri ser brukbar ut.
            return i.costStatus === "verifisert" || i.costPrice == null ? formatNok(i.costPrice) : `${formatNok(i.costPrice)} (${(i.costReason ?? COST_STATUS_LABEL[i.costStatus]).toLowerCase()})`;
          case "agreed":
            return i.agreedPrice != null ? formatNok(i.agreedPrice) : "";
          case "deviation":
            // Bare serverbevist avvik er et tall; ukjent eksporteres som status, aldri 0.
            if (i.comparison.state === "eligible") return formatNumber(i.comparison.deviation, 1);
            return i.comparison.state === "unknown" && !i.comparison.needsControl ? "" : i.comparison.label;
          case "package":
            return i.packageState;
          case "volume_12m":
            return formatNumber(i.volume12m, 0);
          case "last_invoice":
            return formatDate(i.lastInvoiceDate);
          case "stock":
            return i.stockTracking ? formatNumber(i.currentStock, 0) : "";
          case "status":
            return (
              [
                i.declarationName ? "dekl" : "",
                i.hasDatasheet ? "datablad" : "",
                i.hasAllergens ? "allergen" : "",
                i.hasNutrition ? "næring" : "",
              ]
                .filter(Boolean)
                .join(" ")
            );
          case "price_source":
            return priceSourceLabel(i.costSource);
          case "price_updated":
            return formatDate(i.costUpdatedAt);
          case "active":
            return i.isActive ? "Aktiv" : "Inaktiv";
          default:
            return "";
  }
}
