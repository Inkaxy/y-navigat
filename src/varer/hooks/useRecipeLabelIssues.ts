import { useMemo } from "react";
import { useRecipeBreadscaleEffective, useRecipeLabelCalculated } from "@/varer/hooks/useRecipeLabel";
import { useLegalEntityLabelInfo } from "@/varer/hooks/useLegalEntityLabelInfo";
import {
  buildEffectiveDeclaration,
  type DeclarationMode,
  type RecipeLabelSnapshot,
} from "@/varer/lib/effectiveDeclaration";
import { buildLabelChecklist, type ChecklistItem } from "@/varer/lib/labelChecklist";
import { draftLabelFlags, labelChecklistInput } from "@/varer/lib/recipeLabelIssues";
import { checkManualAllergens, manualAllergenChecklistItems, manualAllergenIssues } from "@/varer/lib/manualAllergenCheck";
import type { LabelRecipe } from "@/varer/components/recipes/label/LabelTab";
import type { MissingData } from "@/varer/components/recipes/label/DataQualityCard";

export type SourceState = "loading" | "error" | "ready";

export interface RecipeLabelIssues {
  state: SourceState;
  checklist: ChecklistItem[];
  blockReasons: string[];
  declarationManual: boolean;
  retry: () => void;
}

/**
 * Det som sperrer merkingen, til «Gjenstår». Bruker de samme spørringene
 * (samme nøkler) og det samme oppsettet som merkefanens forhåndsvisning, så
 * listen er identisk med «Rett dette før utskrift». Ingen ny beregning.
 */
export function useRecipeLabelIssues(input: {
  recipeId: string | undefined;
  recipeName: string;
  recipe: LabelRecipe | null | undefined;
  legalEntityId: string | null | undefined;
}): RecipeLabelIssues {
  const labelQuery = useRecipeLabelCalculated(input.recipeId);
  const entityQuery = useLegalEntityLabelInfo(input.legalEntityId);
  const grainQuery = useRecipeBreadscaleEffective(input.recipeId);
  const recipe = input.recipe ?? null;
  const declarationManual = ((recipe?.declaration_mode as DeclarationMode | null) ?? "auto") === "manual";

  const result = useMemo(() => {
    if (!recipe) return { checklist: [] as ChecklistItem[], blockReasons: [] as string[] };
    const label = labelQuery.data ?? null;
    const missing = (label?.missing_data ?? null) as MissingData | null;
    const effective = buildEffectiveDeclaration(
      {
        id: "",
        product_id: "",
        recipe_id: input.recipeId ?? "",
        declaration_mode: null,
        manual_ingredient_declaration: null,
        manual_nutrition: null,
        manual_allergen_summary: null,
        recipes: {
          declaration_mode: (recipe.declaration_mode as DeclarationMode | null) ?? "auto",
          manual_ingredient_declaration: recipe.manual_ingredient_declaration ?? null,
          manual_nutrition: recipe.manual_nutrition ?? null,
          manual_allergen_summary: recipe.manual_allergen_summary ?? null,
        },
      },
      (label ?? null) as RecipeLabelSnapshot | null,
    );
    const keyhole = (label?.keyhole ?? null) as { status?: string } | null;
    const flags = draftLabelFlags({
      declarationManual,
      coveragePct: label?.coverage_by_weight_pct ?? null,
      calculationBlocked: !!missing?.blocked,
      hasNutrition: !!effective.nutrition,
      effectiveGrainPct: grainQuery.data,
      breadscaleManual: recipe.breadscale_mode === "manual",
      manualBreadscalePct: recipe.manual_breadscale_pct ?? null,
      calculatedGrainPct: label?.grain_score_pct ?? null,
    });
    const checklist = buildLabelChecklist(
      labelChecklistInput({
        recipeName: input.recipeName,
        effective,
        effectiveGrainPct: flags.grainPct,
        declarationManual,
        claimGrain: !!recipe.label_claim_grain,
        claimKeyhole: !!recipe.label_claim_keyhole,
        unitWeightGrams: recipe.unit_weight_grams ?? null,
        shelfLifeDays: recipe.shelf_life_days ?? null,
        storageInstructions: recipe.storage_instructions ?? null,
        entity: entityQuery.data ?? null,
        nutritionUsable: flags.nutritionUsable,
        blocked: flags.blocked,
        keyholeQualifies: keyhole?.status === "oppfylt",
        coveragePct: label?.coverage_by_weight_pct ?? null,
      }),
    );
    // Manuell kilde: allergenene fra råvarene må stå fremhevet i den lagrede teksten (art. 21).
    const allergenItems = declarationManual
      ? manualAllergenChecklistItems(
          manualAllergenIssues({
            check: checkManualAllergens(recipe.manual_ingredient_declaration ?? null, label ? label.allergens?.contains ?? [] : null),
            unreviewedCount: missing?.allergens_unreviewed?.length ?? 0,
          }),
        )
      : [];
    return { checklist: [...checklist.items, ...allergenItems], blockReasons: missing?.block_reasons ?? [] };
  }, [recipe, labelQuery.data, entityQuery.data, grainQuery.data, declarationManual, input.recipeId, input.recipeName]);

  const loading =
    !recipe ||
    labelQuery.isLoading ||
    grainQuery.isLoading ||
    (!!input.legalEntityId && entityQuery.isLoading);
  const error = labelQuery.isError || entityQuery.isError;

  return {
    state: error ? "error" : loading ? "loading" : "ready",
    checklist: result.checklist,
    blockReasons: result.blockReasons,
    declarationManual,
    retry: () => {
      void labelQuery.refetch();
      void entityQuery.refetch();
      void grainQuery.refetch();
    },
  };
}
