import { useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LabelTab, type LabelRecipe } from "@/varer/components/recipes/label/LabelTab";
import type { RecipeLabelCalculated, RecipeLinkedProduct } from "@/varer/hooks/useRecipeLabel";
import type { RecipeDeclarationVersion } from "@/varer/hooks/useLabelApproval";

/**
 * Syntetisk forhåndsvisning av merkefanen (fase 2) med eksempeldata i en egen
 * spørringscache. Ingenting lagres: ingen innlogging, skriving feiler lukket.
 * `?modus=manuell` viser manuell deklarasjon.
 */
const RID = "preview-recipe";
const NOW = "2026-11-10T09:00:00Z";

const CALC: RecipeLabelCalculated = {
  recipe_id: RID, computed_at: NOW, total_input_grams: 5200, final_weight_grams: 4400, dry_matter_grams: null, dry_matter_pct: 62,
  flour_grams: 2400, whole_grain_grams: 1200, whole_grain_pct_of_dry: 38, lines: { coarse_weighted_grams: 1500 },
  grain_score_pct: 58, grain_category: "grovt", rye_share_of_grain_pct: 10,
  nutrition_per_100g: null,
  ingredient_declaration: "*Hvete*mel, vann, blåbær, sukker, *egg*, *smør* (*melk*), bakepulver, salt.",
  allergens: { contains: ["hvete", "egg", "melk"], may_contain: [] },
  keyhole: { group: "brod", group_label: "Brød", group_choice_reason: null, status: "ukjent", status_reason: "Næringsinnholdet mangler for 1 råvare", criteria: [], advice: [] },
  coverage_by_weight_pct: 86,
  missing_data: { nutrition: [], lines_without_nutrition_over_pct: [{ name: "Blåbær, frosne", pct_of_weight: 14 }], allergens_unreviewed: [], blocked: false, block_reasons: [] },
  warnings: [], is_stale: true, stale_reason: "En råvare er endret etter siste godkjenning",
};

const LINKS: RecipeLinkedProduct[] = [
  { id: "l1", product_id: "p1", recipe_id: RID, updated_at: NOW, is_primary: true, declaration_mode: null, sales_unit_basis: null, units_per_sales_unit: null, sales_unit_weight_g: null, units_per_batch_override: null, sales_unit_confirmed_at: null,
    products: { id: "p1", display_name: "Blåbærmuffins", display_number: 2041, breadscale_mode: null, breadscale_pct: null, breadscale_value: null, weight_per_unit_grams: null, cert_norsk_100: false } },
  { id: "l2", product_id: "p2", recipe_id: RID, updated_at: NOW, is_primary: false, declaration_mode: null, sales_unit_basis: "stk", units_per_sales_unit: 4, sales_unit_weight_g: 344, units_per_batch_override: null, sales_unit_confirmed_at: NOW,
    products: { id: "p2", display_name: "Blåbærmuffins 4-pk", display_number: 2042, breadscale_mode: null, breadscale_pct: null, breadscale_value: null, weight_per_unit_grams: 344, cert_norsk_100: true } },
] as RecipeLinkedProduct[];

const VERSION: RecipeDeclarationVersion = {
  id: "v1", version: 3, source: "calculated", approved_at: "2026-10-02T08:00:00Z", approved_by: null, diff_from_previous: null,
  ingredient_text: "*Hvete*mel, vann, blåbær, sukker, *egg*, *smør* (*melk*), salt.", ingredient_html: null,
  allergens_contains: ["hvete", "egg", "melk"], allergens_may_contain: [], nutrition_per_100g: { energy_kj: 1420, energy_kcal: 339, fat: 14, saturated_fat: 7.8, carbohydrate: 46, sugars: 19, protein: 6.1, salt: 0.6 },
  coverage_pct: 100, net_weight_g: 86, shelf_life_days: 3, storage_text: "Oppbevares tørt", origin_text: null,
  claim_grain: false, claim_keyhole: false, breadscale_pct: null, restored_from_version_id: null,
};

export default function MerkingPreview() {
  const manual = new URLSearchParams(window.location.search).get("modus") === "manuell";
  const [client] = useState(() => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } });
    qc.setQueryData(["recipe-label-calculated", RID], CALC);
    qc.setQueryData(["recipe-linked-products", RID], LINKS);
    qc.setQueryData(["recipe-breadscale-effective", RID], 58);
    qc.setQueryData(["legal-entity-label", "le"], { name: "Nøtterø Bakeri AS", address_line1: "Eksempelveien 1", postal_code: "3140", city: "Nøtterøy" });
    qc.setQueryData(["recipe-label-profile", RID], null);
    qc.setQueryData(["recipe-declaration-versions", RID], [VERSION]);
    qc.setQueryData(["recipe-free-text-lines", RID], []);
    return qc;
  });
  const recipe = useMemo<LabelRecipe>(() => ({
    declaration_mode: manual ? "manual" : "auto",
    manual_ingredient_declaration: manual ? "Hvetemel, vann, blåbær, sukker, EGG, smør, salt." : null,
    manual_allergen_summary: manual ? { contains: ["hvete", "egg", "melk"], may_contain: [] } : null,
    manual_nutrition: null,
    breadscale_mode: "auto", manual_breadscale_pct: null, unit_weight_grams: null, shelf_life_days: 3,
    storage_instructions: null, country_of_origin: null, label_claim_keyhole: false, label_claim_grain: false,
  }), [manual]);
  return (
    <QueryClientProvider client={client}>
      <main className="mx-auto max-w-[1400px] space-y-3 px-page py-4">
        <p className="text-caption text-muted-foreground">Forhåndsvisning med eksempeldata — ingenting lagres.</p>
        <LabelTab
          recipeId={RID}
          recipeName="Blåbærmuffins"
          recipe={recipe}
          flourLines={[]}
          legalEntityId="le"
          canWrite
          basisInput={{ unitCount: 48, totalDoughG: 5200, finalWeightG: 4128, pieceWeightG: 108 }}
        />
      </main>
    </QueryClientProvider>
  );
}
