import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { BAKERS_RM_KEY, fetchBakersRawMaterials } from "@/varer/lib/bakersRawMaterials";
import type { HistoryRow, UsageLine } from "@/varer/lib/prisgrunnlag";

/** Råvarer med kost (samme henting og nøkkel som alle kalkyler). */
export function usePrisgrunnlagMaterials(legalEntityId: string | null) {
  return useQuery({ queryKey: BAKERS_RM_KEY(legalEntityId), enabled: !!legalEntityId, queryFn: () => fetchBakersRawMaterials(legalEntityId) });
}

type HRow = { raw_material_id: string; price: number; effective_date: string; snapshot_unit: string | null; snapshot_currency: string | null; currency: string | null; rm: { legal_entity_id: string } | null };

/** Gyldige fakturapriser (ikke kreditnota, ikke erstattet/eldre) med låst enhet. Komplett uthenting. */
export function usePrisgrunnlagHistory(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["varer", "prisgrunnlag", "historikk", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<HistoryRow[]> => {
      const rows = await fetchAllRows<HRow>((from, to) =>
        supabase.from("raw_material_price_history")
          .select("raw_material_id, price, effective_date, snapshot_unit, snapshot_currency, currency, rm:raw_materials!raw_material_price_history_raw_material_id_fkey!inner(legal_entity_id)")
          .eq("rm.legal_entity_id", legalEntityId!).eq("source", "invoice").eq("is_legacy", false)
          .is("superseded_at", null).not("is_credit", "is", true).gt("price", 0)
          .order("id").range(from, to));
      return rows.map((r) => ({
        rawMaterialId: r.raw_material_id, price: Number(r.price), date: r.effective_date,
        unit: r.snapshot_unit, currency: r.snapshot_currency ?? null,
      }));
    },
  });
}

export interface RecipeUsage {
  recipeId: string; recipeName: string; unitsPerBatch: number | null;
  lines: UsageLine[];
  products: { id: string; number: number | null; name: string }[];
}

type RecipeRow = { id: string; name: string | null; product_id: string | null; units_per_batch: number | null };
type LineRow = { recipe_id: string; raw_material_id: string | null; quantity: number | null; unit: string | null; quantity_grams: number | null; waste_percent: number | null };
type LinkRow = { recipe_id: string; product_id: string };
type ProdRow = { id: string; display_number: number | null; display_name: string; status: string | null };

/** Gjeldende oppskrifter med råvarelinjer og varene de er kostgrunnlag for. */
export function useRecipeUsage(legalEntityId: string | null) {
  return useQuery({
    queryKey: ["varer", "prisgrunnlag", "bruk", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<RecipeUsage[]> => {
      const le = legalEntityId!;
      const [recipes, prods] = await Promise.all([
        fetchAllRows<RecipeRow>((f, t) => supabase.from("recipes").select("id, name, product_id, units_per_batch")
          .eq("legal_entity_id", le).is("valid_to", null).order("id").range(f, t)),
        fetchAllRows<ProdRow>((f, t) => supabase.from("products").select("id, display_number, display_name, status")
          .eq("legal_entity_id", le).order("id").range(f, t)),
      ]);
      const ids = recipes.map((r) => r.id);
      const lines: LineRow[] = [];
      const links: LinkRow[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const chunk = ids.slice(i, i + 150);
        const [l, k] = await Promise.all([
          fetchAllRows<LineRow>((f, t) => supabase.from("recipe_lines")
            .select("recipe_id, raw_material_id, quantity, unit, quantity_grams, waste_percent").in("recipe_id", chunk).order("id").range(f, t)),
          fetchAllRows<LinkRow>((f, t) => supabase.from("product_recipe_links").select("recipe_id, product_id").in("recipe_id", chunk).order("id").range(f, t)),
        ]);
        lines.push(...l);
        links.push(...k);
      }
      const prodById = new Map(prods.filter((p) => p.status !== "discontinued").map((p) => [p.id, p]));
      return recipes.map((r) => {
        const pids = new Set<string>([...(r.product_id ? [r.product_id] : []), ...links.filter((k) => k.recipe_id === r.id).map((k) => k.product_id)]);
        return {
          recipeId: r.id, recipeName: r.name ?? "Uten navn", unitsPerBatch: r.units_per_batch == null ? null : Number(r.units_per_batch),
          lines: lines.filter((l) => l.recipe_id === r.id && l.raw_material_id).map((l) => ({
            rawMaterialId: l.raw_material_id!, quantity: l.quantity == null ? null : Number(l.quantity), unit: l.unit,
            quantityGrams: l.quantity_grams == null ? null : Number(l.quantity_grams), wastePct: l.waste_percent == null ? null : Number(l.waste_percent),
          })),
          products: [...pids].flatMap((id) => { const p = prodById.get(id); return p ? [{ id, number: p.display_number, name: p.display_name }] : []; }),
        };
      });
    },
  });
}
