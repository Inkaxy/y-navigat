import type { QueryClient } from "@tanstack/react-query";

/**
 * Felles invalidering for Råvarer- og Fakturaer-modulen.
 *
 * Bakgrunn: nøklene i modulen er ikke navngitt konsekvent (noen med
 * understrek, noen med bindestrek), og flere steder invaliderte bare én eller
 * to av dem. Resultatet var flater som viste gamle tall i inntil fem minutter
 * — og i verste fall skrev gammel state tilbake. Alle nøkler som finnes i
 * modulen er derfor samlet her.
 *
 * Råvare-nøkler som dekkes:
 *   raw_materials, ["raw_material", id], raw_material_suppliers,
 *   raw_material_price_history, raw_material_nutrition, raw_material_allergens,
 *   raw-material-datasheets, raw-material-changelog, raw-material-changelog-count,
 *   raw-material-categories, declaration-worklist, raw_material_package_worklist,
 *   raw_material_cost_recalcs, suspicious_packages, package-suggestions,
 *   raw-material-units, purchase-stats, purchase-stats-all, purchase-stats-range,
 *   supplier-purchase-stats, supplier-spend, supplier-items, agreements,
 *   raw-material-stock-status, resale-stock-status, stock-items, stock-movements,
 *   stock-has-movements, stock-tracked-raw-materials, raw-material-products,
 *   receipt-invoices, receipt-lines, raw_materials_autocomplete.
 *
 * Faktura-nøkler som dekkes:
 *   ["fakturaer", …], ["invoice", id], ["invoice-lines", id],
 *   ["invoice-for-lines", id], ["invoice-line-suggestions"],
 *   fakturaer-review-lines, fakturaer-review-count.
 */

/** Nøkler som ikke er knyttet til én bestemt råvare. */
const RAW_MATERIAL_GLOBAL_KEYS: readonly string[] = [
  "raw_materials",
  "raw_materials_autocomplete",
  "raw_material_search_index",
  "raw-material-datasheets",

  "raw-material-changelog",
  "raw-material-changelog-count",
  "raw-material-categories",
  "declaration-worklist",
  "raw_material_package_worklist",
  "raw_material_cost_recalcs",
  "suspicious_packages",
  "package-suggestions",
  "purchase-stats",
  "purchase-stats-all",
  "purchase-stats-range",
  "supplier-purchase-stats",
  "supplier-spend",
  "supplier-items",
  "agreements",
  "raw-material-stock-status",
  "resale-stock-status",
  "stock-items",
  "stock-movements",
  "stock-has-movements",
  "stock-tracked-raw-materials",
  "raw-material-products",
  "receipt-invoices",
  "receipt-lines",
];

/** Nøkler som tar råvare-id som andre ledd. */
const RAW_MATERIAL_SCOPED_KEYS: readonly string[] = [
  "raw_material",
  "raw_material_suppliers",
  "raw_material_price_history",
  "raw_material_nutrition",
  "raw_material_allergens",
  "raw-material-units",
];

const INVOICE_GLOBAL_KEYS: readonly string[] = [
  "fakturaer",
  "fakturaer-review-lines",
  "fakturaer-review-count",
];

const INVOICE_SCOPED_KEYS: readonly string[] = [
  "invoice",
  "invoice-lines",
  "invoice-for-lines",
  "invoice-line-suggestions",
];

/** Alle nøkler som `invalidateRawMaterial` treffer — brukt i test og lib. */
export function rawMaterialQueryKeys(id?: string): unknown[][] {
  const keys: unknown[][] = RAW_MATERIAL_GLOBAL_KEYS.map((k) => [k]);
  for (const k of RAW_MATERIAL_SCOPED_KEYS) keys.push(id ? [k, id] : [k]);
  return keys;
}

/** Alle nøkler som `invalidateInvoice` treffer. */
export function invoiceQueryKeys(invoiceId?: string): unknown[][] {
  const keys: unknown[][] = INVOICE_GLOBAL_KEYS.map((k) => [k]);
  for (const k of INVOICE_SCOPED_KEYS)
    keys.push(invoiceId ? [k, invoiceId] : [k]);
  return keys;
}

/** Invalider alt som avhenger av en råvare (eller hele modulen når id mangler). */
export function invalidateRawMaterial(qc: QueryClient, id?: string): void {
  for (const queryKey of rawMaterialQueryKeys(id)) {
    void qc.invalidateQueries({ queryKey });
  }
}

/** Invalider alt som avhenger av en faktura. */
export function invalidateInvoice(qc: QueryClient, invoiceId?: string): void {
  for (const queryKey of invoiceQueryKeys(invoiceId)) {
    void qc.invalidateQueries({ queryKey });
  }
}
