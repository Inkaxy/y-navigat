import { formatDate, formatNok, formatNumber } from "@/ravarer/lib/constants";
import type { RawMaterialListItem } from "@/ravarer/lib/rawMaterialViews";

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
            return formatNok(i.costPrice);
          case "agreed":
            return i.agreedPrice != null ? formatNok(i.agreedPrice) : "";
          case "deviation":
            return i.deviation != null ? formatNumber(i.deviation, 1) : "";
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
