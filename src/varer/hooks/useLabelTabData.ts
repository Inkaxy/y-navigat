import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLegalEntityLabelInfo } from "@/varer/hooks/useLegalEntityLabelInfo";
import {
  useComputeRecipeLabel,
  useRecipeBreadscaleEffective,
  useRecipeLabelCalculated,
  useRecipeLinkedProducts,
  useUserDisplayName,
} from "@/varer/hooks/useRecipeLabel";
import { useApproveDeclaration, useRecipeDeclarationVersions } from "@/varer/hooks/useLabelApproval";
import { useRecipeLabelProfile } from "@/varer/hooks/useRecipeLabelProfile";
import {
  buildEffectiveDeclaration,
  parseAllergenSummary,
  pickNutrition,
  type DeclarationMode,
  type NutritionPer100g,
  type RecipeLabelSnapshot,
} from "@/varer/lib/effectiveDeclaration";
import { labelApproveIssues } from "@/varer/lib/labelApproveIssues";
import { labelProducerAddress } from "@/varer/lib/recipeLabelIssues";
import { deriveLabelState, deriveNextAction } from "@/varer/lib/labelWorkspace";
import type { LabelSource } from "@/varer/components/recipes/label/labelShared";
import type { ApproveSourceData } from "@/varer/components/recipes/label/ApproveDeclarationDialog";
import type { MissingData } from "@/varer/components/recipes/label/DataQualityCard";
import type { KeyholeResult } from "@/varer/components/recipes/label/KeyholeSection";
import type { LabelRecipe } from "@/varer/components/recipes/label/LabelTab";

/**
 * Data og avledede verdier for merkefanen: spørringene, merkevalget
 * (`saveClaim`), den effektive deklarasjonen og godkjenningssperrene.
 * Flyttet uendret ut av `LabelTab` for å holde komponenten liten.
 */
export function useLabelTabData(recipeId: string, recipeName: string, recipe: LabelRecipe, legalEntityId: string | undefined) {
  const qc = useQueryClient();
  const labelQuery = useRecipeLabelCalculated(recipeId);
  const compute = useComputeRecipeLabel();
  const linksQuery = useRecipeLinkedProducts(recipeId);
  const effectiveGrain = useRecipeBreadscaleEffective(recipeId);

  const entityQuery = useLegalEntityLabelInfo(legalEntityId);

  const saveClaim = useMutation({
    mutationFn: async (input: { field: "label_claim_keyhole" | "label_claim_grain"; value: boolean }) => {
      const { data: u } = await supabase.auth.getUser();
      const patch: Record<string, unknown> = { [input.field]: input.value };
      if (input.value) {
        patch.label_claims_approved_by = u.user?.id ?? null;
        patch.label_claims_approved_at = new Date().toISOString();
      }
      const { error } = await supabase.from("recipes").update(patch as never).eq("id", recipeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recipe-detail", recipeId] });
      toast.success("Merkevalget er lagret");
    },
    onError: (e: unknown) => toast.error((e as Error).message ?? "Kunne ikke lagre"),
  });

  const labelProfileQuery = useRecipeLabelProfile(recipeId);
  const approve = useApproveDeclaration();

  const label = labelQuery.data ?? null;
  const coveragePct = label?.coverage_by_weight_pct ?? null;
  const coverageOk = (coveragePct ?? 0) >= 90;
  const keyhole = (label?.keyhole ?? null) as KeyholeResult | null;
  const links = linksQuery.data ?? [];
  const primaryCount = links.filter((l) => l.is_primary).length;

  // Godkjenningsgrunnlag = nyeste deklarasjonsversjon, aldri lagringsdatoen.
  const versionsQuery = useRecipeDeclarationVersions(recipeId);
  const latestVersion = versionsQuery.data?.[0] ?? null;
  const approvedAt = latestVersion?.approved_at ?? null;
  const approverQuery = useUserDisplayName(latestVersion?.approved_by ?? null);
  const missing = (label?.missing_data ?? null) as MissingData | null;
  const labelState = deriveLabelState({
    computedAt: label?.computed_at ?? null,
    isStale: label?.is_stale ?? null,
    approvedAt,
  });
  const hasCalc = !!label?.computed_at;

  const declarationManual = ((recipe.declaration_mode as DeclarationMode | null) ?? "auto") === "manual";
  const savedSource: LabelSource = declarationManual ? "manual" : "auto";
  const breadscaleMode: "auto" | "manual" = recipe.breadscale_mode === "manual" ? "manual" : "auto";

  const recompute = () =>
    compute.mutate(recipeId, {
      onSuccess: () => {
        toast.success("Merkedata beregnet på nytt");
        qc.invalidateQueries({ queryKey: ["recipe-breadscale-effective", recipeId] });
      },
    });

  /** Det som faktisk følger produktet — brukes i etikett og forhåndsvisning. */
  const effective = useMemo(
    () =>
      buildEffectiveDeclaration(
        {
          id: "",
          product_id: "",
          recipe_id: recipeId,
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
      ),
    [recipe, label, recipeId],
  );

  const manualSource: ApproveSourceData = useMemo(() => {
    const al = parseAllergenSummary(recipe.manual_allergen_summary);
    const nut = pickNutrition(recipe.manual_nutrition) as NutritionPer100g | null;
    return {
      ingredientText: recipe.manual_ingredient_declaration ?? null,
      contains: al.contains,
      mayContain: al.may_contain,
      nutrition: (nut ?? null) as Record<string, number | null> | null,
    };
  }, [recipe.manual_allergen_summary, recipe.manual_ingredient_declaration, recipe.manual_nutrition]);

  const entity = entityQuery.data ?? null;
  const producerAddress = entity ? labelProducerAddress(entity) : null;

  // Pliktfeltene vurderes per kilde. En sperret beregning skal ikke hindre
  // godkjenning av en komplett manuell deklarasjon.
  const approveIssues = useMemo(
    () =>
      labelApproveIssues({
        recipeName,
        calculated: {
          ingredientText: label?.ingredient_declaration ?? null,
          contains: label?.allergens?.contains ?? [],
          mayContain: label?.allergens?.may_contain ?? [],
          nutrition: (label?.nutrition_per_100g ?? null) as Record<string, number | null> | null,
        },
        manual: manualSource,
        netWeightGrams: recipe.unit_weight_grams ?? null,
        shelfLifeDays: recipe.shelf_life_days ?? null,
        storageInstructions: recipe.storage_instructions ?? null,
        producerName: entity?.name ?? null,
        producerAddress: producerAddress || null,
        coveragePct,
        calculationBlocked: !!missing?.blocked,
        claimGrain: !!recipe.label_claim_grain,
        grainPct: label?.grain_score_pct ?? null,
        claimKeyhole: !!recipe.label_claim_keyhole,
        keyholeQualifies: keyhole?.status === "oppfylt",
        knownAllergens: label ? label.allergens?.contains ?? [] : null,
      }),
    [coveragePct, entity, keyhole, label, manualSource, missing, producerAddress, recipe.label_claim_grain, recipe.label_claim_keyhole, recipe.shelf_life_days, recipe.storage_instructions, recipe.unit_weight_grams, recipeName],
  );

  const sourceIssues = declarationManual ? approveIssues.manual : approveIssues.auto;
  const nextAction = deriveNextAction({ state: labelState, approveIssues: sourceIssues });

  return {
    qc, labelQuery, compute, linksQuery, effectiveGrain, entityQuery, saveClaim, labelProfileQuery, approve,
    label, coveragePct, coverageOk, keyhole, links, primaryCount, versionsQuery, latestVersion, approvedAt,
    approverQuery, missing, labelState, hasCalc, declarationManual, savedSource, breadscaleMode, recompute,
    effective, manualSource, entity, producerAddress, approveIssues, sourceIssues, nextAction,
    recipeClaims: { grain: !!recipe.label_claim_grain, keyhole: !!recipe.label_claim_keyhole },
  };
}
