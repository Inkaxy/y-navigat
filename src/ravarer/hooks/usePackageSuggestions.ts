import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Pakningsforslag hentet fra den nyeste fakturalinja per råvare. */
export interface PackageSuggestion {
  raw_material_id: string;
  package_size: number;
  package_unit: string | null;
  count_per_package: number | null;
  description: string | null;
  invoice_date: string | null;
}

/**
 * Nyeste fakturalinje med pakningsdata per vare — hentet i én spørring, slik at
 * pakningslista slipper ett kall per rad.
 */
export function usePackageSuggestions(rawMaterialIds: string[]) {
  const key = rawMaterialIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["package-suggestions", key],
    enabled: rawMaterialIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Map<string, PackageSuggestion>> => {
      // Store-grensa på antall verdier i .in() krever chunking for lange lister.
      const chunkSize = 100;
      const rows: {
        raw_material_id: string | null;
        package_size: number | null;
        package_unit: string | null;
        count_per_package: number | null;
        description: string | null;
        invoice: { invoice_date: string | null } | null;
      }[] = [];
      for (let i = 0; i < rawMaterialIds.length; i += chunkSize) {
        const chunk = rawMaterialIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("invoice_lines")
          .select(
            "raw_material_id, package_size, package_unit, count_per_package, description, invoice:invoices!inner(invoice_date)",
          )
          .in("raw_material_id", chunk)
          .not("package_size", "is", null)
          .order("created_at", { ascending: false })
          .limit(2000);
        if (error) throw error;
        rows.push(...(data ?? []));
      }

      const map = new Map<string, PackageSuggestion>();
      for (const row of rows) {
        const rmId = row.raw_material_id;
        if (!rmId) continue;
        const invoice = row.invoice as { invoice_date: string | null } | null;
        const existing = map.get(rmId);
        const date = invoice?.invoice_date ?? null;
        if (existing && (existing.invoice_date ?? "") >= (date ?? "")) continue;
        map.set(rmId, {
          raw_material_id: rmId,
          package_size: Number(row.package_size),
          package_unit: row.package_unit,
          count_per_package: row.count_per_package,
          description: row.description,
          invoice_date: date,
        });
      }
      return map;
    },
  });
}
