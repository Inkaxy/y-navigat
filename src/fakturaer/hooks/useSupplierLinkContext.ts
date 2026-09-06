import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { normalizeSearch } from "@/ravarer/lib/rawMaterialViews";

export interface SupplierLinkRow {
  id: string;
  raw_material_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  package_size: number | null;
  package_unit: string | null;
  base_units_per_package: number | null;
  package_confirmed_at: string | null;
  agreed_price_per_base_unit: number | null;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
  raw_material: { name: string; sku: string | null; base_unit: string | null; category: string | null } | null;
}

export interface SupplierLinkContext {
  byRawMaterialId: Map<string, SupplierLinkRow>;
  bySku: Map<string, SupplierLinkRow>;
  byName: Map<string, SupplierLinkRow>;
  /** Slår opp koblingen for en fakturalinje: matchet vare → SKU → produktnavn. */
  forLine: (line: {
    raw_material_id: string | null;
    supplier_sku: string | null;
    description: string | null;
  }) => SupplierLinkRow | null;
}

const EMPTY: SupplierLinkContext = {
  byRawMaterialId: new Map(),
  bySku: new Map(),
  byName: new Map(),
  forLine: () => null,
};

/**
 * Leverandørens varekoblinger (avtalepris, siste fakturapris, pakning) i ÉN
 * spørring — ikke én per fakturalinje. Køen bruker den til å vise
 * sammenligningstall rett i tabellen.
 */
export function useSupplierLinkContext(supplierIds: readonly string[]): SupplierLinkContext {
  const ids = [...new Set(supplierIds.filter(Boolean))].sort();

  const { data } = useQuery({
    queryKey: ["invoice-supplier-links", ids],
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () =>
      fetchAllRows<SupplierLinkRow>((from, to) =>
        supabase
          .from("raw_material_suppliers")
          .select(
            `id, raw_material_id, supplier_sku, supplier_product_name, package_size, package_unit,
             base_units_per_package, package_confirmed_at, agreed_price_per_base_unit,
             last_invoice_price, last_invoice_date,
             raw_material:raw_materials(name, sku, base_unit, category)`,
          )
          .in("supplier_id", ids)
          .range(from, to) as unknown as PromiseLike<{
          data: SupplierLinkRow[] | null;
          error: { message: string } | null;
        }>,
      ),
  });

  if (!data) return EMPTY;

  const byRawMaterialId = new Map<string, SupplierLinkRow>();
  const bySku = new Map<string, SupplierLinkRow>();
  const byName = new Map<string, SupplierLinkRow>();
  for (const row of data) {
    byRawMaterialId.set(row.raw_material_id, row);
    if (row.supplier_sku) bySku.set(normalizeSearch(row.supplier_sku), row);
    if (row.supplier_product_name) byName.set(normalizeSearch(row.supplier_product_name), row);
  }

  return {
    byRawMaterialId,
    bySku,
    byName,
    forLine: (line) => {
      if (line.raw_material_id) {
        const hit = byRawMaterialId.get(line.raw_material_id);
        if (hit) return hit;
      }
      if (line.supplier_sku) {
        const hit = bySku.get(normalizeSearch(line.supplier_sku));
        if (hit) return hit;
      }
      if (line.description) {
        const hit = byName.get(normalizeSearch(line.description));
        if (hit) return hit;
      }
      return null;
    },
  };
}
