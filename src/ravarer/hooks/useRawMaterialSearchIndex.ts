import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { useRavarer } from "@/ravarer/context/RavarerContext";

/**
 * Søke- og statusindeks for varelisten.
 *
 * Varelisten skal kunne søkes på leverandørens varenummer og bekreftede
 * aliaser, og vise om råvaren har datablad, næring og allergener. Alt hentes
 * én gang per selskap (373 råvarer, ~350 koblinger, ~240 aliaser) og bygges om
 * til oppslag i minnet — ellers hadde listen krevd et kall per rad.
 */

export interface SupplierLinkIndexRow {
  /** id på raw_material_suppliers-raden — trengs for å skrive avtalepris. */
  id: string;
  supplierId: string;
  supplierSku: string | null;
  supplierProductName: string | null;
  agreedPricePerBaseUnit: number | null;
  lastInvoicePrice: number | null;
  lastInvoiceDate: string | null;
  isPrimary: boolean;
  aliases: string[];
}


export interface RawMaterialSearchIndex {
  /** Alle leverandørkoblinger per råvare, primær først. */
  linksByRawMaterial: Map<string, SupplierLinkIndexRow[]>;
  nutritionIds: Set<string>;
  datasheetIds: Set<string>;
  allergenIds: Set<string>;
}

interface LinkRow {
  id: string;
  raw_material_id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_product_name: string | null;
  agreed_price_per_base_unit: number | null;
  last_invoice_price: number | null;
  last_invoice_date: string | null;
  is_primary: boolean;
}

interface AliasRow {
  raw_material_supplier_id: string;
  alias_value: string;
}

export function useRawMaterialSearchIndex() {
  const { legalEntityId } = useRavarer();

  return useQuery({
    queryKey: ["raw_material_search_index", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 60_000,
    queryFn: async (): Promise<RawMaterialSearchIndex> => {
      const [links, aliases, nutrition, datasheets, allergens] = await Promise.all([
        fetchAllRows<LinkRow>((from, to) =>
          supabase
            .from("raw_material_suppliers")
            .select(
              "id, raw_material_id, supplier_id, supplier_sku, supplier_product_name, agreed_price_per_base_unit, last_invoice_price, last_invoice_date, is_primary",
            )
            .range(from, to),
        ),
        fetchAllRows<AliasRow>((from, to) =>
          supabase
            .from("raw_material_supplier_aliases")
            .select("raw_material_supplier_id, alias_value")
            .eq("status", "confirmed")
            .range(from, to),
        ),
        fetchAllRows<{ raw_material_id: string }>((from, to) =>
          supabase.from("raw_material_nutrition").select("raw_material_id").range(from, to),
        ),
        fetchAllRows<{ raw_material_id: string | null }>((from, to) =>
          supabase
            .from("raw_material_datasheets")
            .select("raw_material_id")
            .eq("is_current", true)
            .range(from, to),
        ),
        fetchAllRows<{ raw_material_id: string }>((from, to) =>
          supabase.from("raw_material_allergens").select("raw_material_id").range(from, to),
        ),
      ]);

      const aliasByLink = new Map<string, string[]>();
      for (const a of aliases) {
        const list = aliasByLink.get(a.raw_material_supplier_id);
        if (list) list.push(a.alias_value);
        else aliasByLink.set(a.raw_material_supplier_id, [a.alias_value]);
      }

      const linksByRawMaterial = new Map<string, SupplierLinkIndexRow[]>();
      for (const l of links) {
        const row: SupplierLinkIndexRow = {
          supplierId: l.supplier_id,
          supplierSku: l.supplier_sku,
          supplierProductName: l.supplier_product_name,
          agreedPricePerBaseUnit: l.agreed_price_per_base_unit,
          lastInvoicePrice: l.last_invoice_price,
          lastInvoiceDate: l.last_invoice_date,
          isPrimary: l.is_primary,
          aliases: aliasByLink.get(l.id) ?? [],
        };
        const list = linksByRawMaterial.get(l.raw_material_id);
        if (list) list.push(row);
        else linksByRawMaterial.set(l.raw_material_id, [row]);
      }
      for (const list of linksByRawMaterial.values()) {
        list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
      }

      return {
        linksByRawMaterial,
        nutritionIds: new Set(nutrition.map((n) => n.raw_material_id)),
        datasheetIds: new Set(
          datasheets.map((d) => d.raw_material_id).filter((id): id is string => !!id),
        ),
        allergenIds: new Set(allergens.map((a) => a.raw_material_id)),
      };
    },
  });
}
