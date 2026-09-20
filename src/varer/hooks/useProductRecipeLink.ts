import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  computeTotalsForRecipe,
  type BakersLine,
  type BakersRawMaterial,
} from "@/varer/lib/bakers";
import { computeRecipeCost, type RecipeCostTotals } from "@/varer/lib/recipeCost";
import { computeUnitCount, resolveFinalWeight } from "@/varer/lib/units-recipe";
import {
  computeSalesUnitBasis,
  type RecipeLinkSettings,
  type SalesUnitBasisResult,
} from "@/varer/lib/recipeLinkBasis";

const RECIPE_FIELDS = `
  id, name, status, version, category, department,
  units_per_batch, unit_weight_grams, dough_piece_grams, dough_waste_pct,
  yield_quantity, yield_unit, yield_grams, yield_loss_pct, finished_weight_grams,
  production_notes, notes, description, shelf_life_days, storage_instructions,
  bake_temp_celsius, bake_time_minutes, steam_seconds, cooling_minutes,
  bulk_proof_minutes, shape_proof_minutes, target_dough_temp_celsius,
  declaration_mode, updated_at,
  recipe_lines(id, recipe_part_id, quantity, unit, raw_material_id, sub_product_id,
    ingredient_name, is_flour_override, water_content_pct_override, waste_percent)
`;

export interface LinkedRecipe {
  id: string;
  name: string | null;
  status: string | null;
  version: number | null;
  category: string | null;
  department: string | null;
  units_per_batch: number | null;
  unit_weight_grams: number | null;
  dough_piece_grams: number | null;
  dough_waste_pct: number | null;
  yield_quantity: number | null;
  yield_unit: string | null;
  yield_grams: number | null;
  yield_loss_pct: number | null;
  finished_weight_grams: number | null;
  production_notes: string | null;
  notes: string | null;
  description: string | null;
  shelf_life_days: number | null;
  storage_instructions: string | null;
  bake_temp_celsius: number | null;
  bake_time_minutes: number | null;
  steam_seconds: number | null;
  cooling_minutes: number | null;
  bulk_proof_minutes: number | null;
  shape_proof_minutes: number | null;
  target_dough_temp_celsius: number | null;
  declaration_mode: string | null;
  updated_at: string | null;
  recipe_lines: BakersLine[] | null;
}

export interface ProductRecipeLinkRow extends RecipeLinkSettings {
  id: string | null;
  recipe_id: string;
  is_primary?: boolean | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  sales_unit_confirmed_at?: string | null;
  sales_unit_confirmed_by?: string | null;
}

export interface RecipeBasisBundle {
  link: ProductRecipeLinkRow | null;
  recipe: LinkedRecipe | null;
  lines: BakersLine[];
  totalDoughG: number | null;
  totalFlourG: number | null;
  hydrationPct: number | null;
  finalWeightG: number | null;
  finalWeightSource: string | null;
  unitCount: number | null;
  cost: RecipeCostTotals | null;
  basis: SalesUnitBasisResult;
  /** Sann når koblingen er en gammeldags direkte kobling (recipes.product_id). */
  legacyDirect: boolean;
}

export const PRODUCT_RECIPE_LINK_KEY = (productId: string) => ["product-recipe-link", productId];

async function loadRawMaterials(): Promise<Record<string, BakersRawMaterial>> {
  const { data } = await supabase
    .from("raw_materials")
    .select(
      "id, name, category, grain_classification, cereal_type, water_content_pct, unit_weight_grams, current_cost_price, density_g_per_ml, is_water, base_unit, is_composite, produced_by_recipe_id",
    )
    .limit(3000);
  const map: Record<string, BakersRawMaterial> = {};
  for (const r of (data ?? []) as unknown as BakersRawMaterial[]) map[r.id] = r;
  return map;
}

/** Bygger hele beregningsgrunnlaget for en oppskrift + koblingens innstillinger. */
export function buildRecipeBasis(
  link: ProductRecipeLinkRow | null,
  recipe: LinkedRecipe | null,
  rmMap: Record<string, BakersRawMaterial>,
): RecipeBasisBundle {
  if (!recipe) {
    return {
      link,
      recipe: null,
      lines: [],
      totalDoughG: null,
      totalFlourG: null,
      hydrationPct: null,
      finalWeightG: null,
      finalWeightSource: null,
      unitCount: null,
      cost: null,
      basis: computeSalesUnitBasis(link, null),
      legacyDirect: false,
    };
  }

  const lines: BakersLine[] = (recipe.recipe_lines ?? []).map((l) => ({
    ...l,
    _rm: l.raw_material_id ? rmMap[l.raw_material_id] ?? null : null,
  }));

  const totals = computeTotalsForRecipe(lines, recipe);
  const unitCount = computeUnitCount(recipe, totals.totalDoughG);
  const final = resolveFinalWeight(recipe, totals.totalDoughG);
  const cost = computeRecipeCost(lines, {
    unitCount,
    totalDoughG: totals.totalDoughG,
  });

  const basis = computeSalesUnitBasis(link, {
    unitCount,
    totalDoughG: totals.totalDoughG,
    finalWeightG: final?.grams ?? null,
    pieceWeightG: recipe.dough_piece_grams ?? recipe.unit_weight_grams ?? null,
    totalCost: cost.totalCost,
    costIncomplete: cost.incomplete,
  });

  return {
    link,
    recipe,
    lines,
    totalDoughG: totals.totalDoughG,
    totalFlourG: totals.totalFlourG,
    hydrationPct: totals.hydrationPct,
    finalWeightG: final?.grams ?? null,
    finalWeightSource: final?.source ?? null,
    unitCount,
    cost,
    basis,
    legacyDirect: link?.id == null && !!link?.recipe_id,
  };
}

/** Koblet oppskrift for en vare, med ferdig beregnet grunnlag. */
export function useProductRecipeLink(productId: string | null | undefined) {
  const rmQuery = useQuery({
    queryKey: ["rm-basis-map"],
    queryFn: loadRawMaterials,
    staleTime: 60_000,
  });

  const linkQuery = useQuery({
    queryKey: PRODUCT_RECIPE_LINK_KEY(productId ?? ""),
    enabled: !!productId,
    queryFn: async (): Promise<{ link: ProductRecipeLinkRow | null; recipe: LinkedRecipe | null }> => {
      const { data, error } = await supabase
        .from("product_recipe_links")
        .select(
          `id, recipe_id, is_primary, notes, created_at, updated_at,
           units_per_batch_override, yield_weight_g_override,
           sales_unit_basis, units_per_sales_unit, sales_unit_weight_g,
           sales_unit_confirmed_at, sales_unit_confirmed_by,
           recipes(${RECIPE_FIELDS})`,
        )
        .eq("product_id", productId!)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        const row = data as unknown as ProductRecipeLinkRow & { recipes: LinkedRecipe | null };
        const { recipes, ...link } = row;
        return { link, recipe: recipes ?? null };
      }
      // Eldre data: oppskriften peker rett på produktet uten koblingsrad.
      const { data: direct } = await supabase
        .from("recipes")
        .select(RECIPE_FIELDS)
        .eq("product_id", productId!)
        .is("valid_to", null)
        .maybeSingle();
      if (!direct) return { link: null, recipe: null };
      const recipe = direct as unknown as LinkedRecipe;
      return { link: { id: null, recipe_id: recipe.id }, recipe };
    },
  });

  const bundle = buildRecipeBasis(
    linkQuery.data?.link ?? null,
    linkQuery.data?.recipe ?? null,
    rmQuery.data ?? {},
  );

  return {
    ...linkQuery,
    rawMaterialsLoading: rmQuery.isLoading,
    bundle,
    hasRecipe: !!linkQuery.data?.recipe,
  };
}
