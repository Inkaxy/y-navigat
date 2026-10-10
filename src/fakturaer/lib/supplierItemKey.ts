import { normalizeMatchKey } from "@/fakturaer/lib/matchNormalize";

/** Samme regel som databasen: varenummer (a–z0–9) først, ellers normalisert navn. */
export function supplierItemKey(line: { supplier_sku?: string | null; description?: string | null }): string | null {
  const sku = (line.supplier_sku ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (sku) return `sku:${sku}`;
  const name = normalizeMatchKey(line.description ?? "");
  return name ? `name:${name}` : null;
}
