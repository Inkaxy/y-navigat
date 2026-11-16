import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PackagingDiff, PackagingLine } from "@/varer/lib/packagingLines";

export const PACKAGING_LINES_KEY = (recipeId: string | null) => ["varer", "recipe-packaging-lines", recipeId] as const;

export interface PackagingLineRow extends PackagingLine {
  baseUnit: string | null;
  usableCost: number | null;
}

type Row = {
  id: string; raw_material_id: string | null; name: string | null; quantity: number; unit_price_override: number | null;
  sort_order: number; updated_at: string;
  rm: { name: string; base_unit: string | null; current_cost_price: number | null; cost_basis_status: string | null } | null;
};

/** Emballasjelinjene i oppskriftens kalkyle (eksisterende tabell recipe_packaging_lines). */
export function usePackagingLines(recipeId: string | null) {
  return useQuery({
    queryKey: PACKAGING_LINES_KEY(recipeId),
    enabled: !!recipeId,
    queryFn: async (): Promise<PackagingLineRow[]> => {
      const { data, error } = await supabase.from("recipe_packaging_lines")
        .select("id, raw_material_id, name, quantity, unit_price_override, sort_order, updated_at, rm:raw_materials!recipe_packaging_lines_raw_material_id_fkey(name, base_unit, current_cost_price, cost_basis_status)")
        .eq("recipe_id", recipeId!).order("sort_order").order("id").limit(200);
      if (error) throw error;
      return ((data ?? []) as Row[]).filter((r) => r.raw_material_id).map((r) => ({
        id: r.id, updatedAt: r.updated_at, rawMaterialId: r.raw_material_id!, name: r.rm?.name ?? r.name ?? "Ukjent",
        quantity: Number(r.quantity), unitPriceOverride: r.unit_price_override == null ? null : Number(r.unit_price_override),
        sortOrder: r.sort_order, baseUnit: r.rm?.base_unit ?? null,
        usableCost: r.rm?.cost_basis_status === "verifisert" && r.rm.current_cost_price != null ? Number(r.rm.current_cost_price) : null,
      }));
    },
  });
}

/** Skriver en gjennomgått kladd. Hver rad er betinget på id + rå updated_at og må gi nøyaktig én rad. */
export function useSavePackagingLines(recipeId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (diff: PackagingDiff) => {
      if (!recipeId) throw new Error("Fant ikke oppskriften.");
      const stale = "Emballasjen er endret et annet sted. Last inn på nytt og kontroller før du lagrer igjen.";
      for (const d of diff.deletes) {
        const { data, error } = await supabase.from("recipe_packaging_lines").delete()
          .eq("id", d.id!).eq("recipe_id", recipeId).eq("updated_at", d.updatedAt!).select("id");
        if (error) throw error;
        if (data?.length !== 1) throw new Error(stale);
      }
      for (const u of diff.updates) {
        const { data, error } = await supabase.from("recipe_packaging_lines")
          .update({ quantity: u.quantity, sort_order: u.sortOrder, unit_price_override: u.unitPriceOverride })
          .eq("id", u.id!).eq("recipe_id", recipeId).eq("updated_at", u.updatedAt!).select("id");
        if (error) throw error;
        if (data?.length !== 1) throw new Error(stale);
      }
      for (const n of diff.inserts) {
        const { data, error } = await supabase.from("recipe_packaging_lines").insert({
          recipe_id: recipeId, raw_material_id: n.rawMaterialId, name: n.name, quantity: n.quantity,
          unit_price_override: n.unitPriceOverride, sort_order: n.sortOrder,
        }).select("id");
        if (error) throw error;
        if (data?.length !== 1) throw new Error("Linjen ble ikke bekreftet. Last inn på nytt og kontroller.");
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: PACKAGING_LINES_KEY(recipeId) });
      void qc.invalidateQueries({ queryKey: ["product-margins"] });
      void qc.invalidateQueries({ queryKey: ["profitability-sheet-matrix"] });
    },
  });
}
