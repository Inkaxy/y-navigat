import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import {
  useComputeRecipeLabel,
  useRecipeBreadscaleEffective,
  useRecipeLabelCalculated,
  useRecipeLinkedProducts,
} from "@/varer/hooks/useRecipeLabel";
import type { FlourLine } from "@/varer/lib/breadscale";
import {
  buildEffectiveDeclaration,
  type DeclarationMode,
  type RecipeLabelSnapshot,
} from "@/varer/lib/effectiveDeclaration";
import { useApproveDeclaration } from "@/varer/hooks/useLabelApproval";
import { useRecipeLabelProfile } from "@/varer/hooks/useRecipeLabelProfile";
import { useUserDisplayName } from "@/varer/hooks/useRecipeLabel";
import { deriveLabelingStatusFromDb } from "@/varer/lib/labelStaleness";
import { parseAllergenSummary, pickNutrition, type NutritionPer100g } from "@/varer/lib/effectiveDeclaration";
import { ApproveDeclarationDialog, type ApproveSourceData } from "./ApproveDeclarationDialog";
import { LabelStatusBar } from "./LabelStatusBar";
import { DataQualityCard, type MissingData } from "./DataQualityCard";
import { DeclarationNutritionSection } from "./DeclarationNutritionSection";
import { GrainSection } from "./GrainSection";
import { KeyholeSection, type KeyholeResult } from "./KeyholeSection";
import { LabelInfoCard } from "./LabelInfoCard";
import { ConsumerLabelSection } from "./ConsumerLabelSection";
import { LinkedProductsCard } from "./LinkedProductsCard";

/** Feltene fra `recipes`-raden som merkefanen bruker. */
export interface LabelRecipe {
  declaration_mode?: DeclarationMode | null;
  manual_ingredient_declaration?: string | null;
  manual_allergen_summary?: unknown;
  manual_nutrition?: unknown;
  declaration_updated_at?: string | null;
  declaration_updated_by?: string | null;
  breadscale_mode?: string | null;
  manual_breadscale_pct?: number | null;
  unit_weight_grams?: number | null;
  shelf_life_days?: number | null;
  storage_instructions?: string | null;
  country_of_origin?: string | null;
  label_claim_keyhole?: boolean | null;
  label_claim_grain?: boolean | null;
  label_claims_approved_by?: string | null;
  label_claims_approved_at?: string | null;
}

interface LegalEntityLabelInfo {
  name: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
}

/** Kolonnenavnene i `legal_entities` — feltene heter invoice_* i basen. */
interface LegalEntityRow {
  legal_name: string | null;
  display_name: string | null;
  invoice_address_line1: string | null;
  invoice_postal_code: string | null;
  invoice_city: string | null;
}

interface Props {
  recipeId: string;
  recipeName: string;
  recipe: LabelRecipe;
  flourLines: FlourLine[];
  legalEntityId: string | undefined;
  canWrite: boolean;
  /** Bytter til Oppskrift-fanen (brukes av datakvalitet-kortet). */
  onGoToRecipeTab?: () => void;
}

/** Merking — kan vi trykke dette på posen, og hvis ikke, hva må endres? */
export function LabelTab({
  recipeId,
  recipeName,
  recipe,
  flourLines,
  legalEntityId,
  canWrite,
  onGoToRecipeTab,
}: Props) {
  const qc = useQueryClient();
  const labelQuery = useRecipeLabelCalculated(recipeId);
  const compute = useComputeRecipeLabel();
  const linksQuery = useRecipeLinkedProducts(recipeId);
  const effectiveGrain = useRecipeBreadscaleEffective(recipeId);

  const entityQuery = useQuery({
    queryKey: ["legal-entity-label", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("legal_name, display_name, invoice_address_line1, invoice_postal_code, invoice_city")
        .eq("id", legalEntityId!)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? null) as LegalEntityRow | null;
      if (!row) return null;
      return {
        // Etiketten skal bære det juridiske navnet, med visningsnavn som reserve.
        name: row.legal_name ?? row.display_name ?? null,
        address_line1: row.invoice_address_line1 ?? null,
        postal_code: row.invoice_postal_code ?? null,
        city: row.invoice_city ?? null,
      } satisfies LegalEntityLabelInfo;
    },
  });

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
  const [approveOpen, setApproveOpen] = useState(false);
  const [checklistBlocked, setChecklistBlocked] = useState(false);
  const onChecklistChange = useCallback((v: boolean) => setChecklistBlocked(v), []);

  const label = labelQuery.data ?? null;
  const coveragePct = label?.coverage_by_weight_pct ?? null;
  const coverageOk = (coveragePct ?? 0) >= 90;
  const keyhole = (label?.keyhole ?? null) as KeyholeResult | null;
  const links = linksQuery.data ?? [];
  const primaryCount = links.filter((l) => l.is_primary).length;

  const approvedAt = recipe.declaration_updated_at ?? null;
  const approverQuery = useUserDisplayName(recipe.declaration_updated_by ?? null);
  const missing = (label?.missing_data ?? null) as MissingData | null;
  // Utdatert-vurderingen kommer nå fra basen (trigger på recipe_label_calculated).
  const status = deriveLabelingStatusFromDb({
    approvedAt,
    computedAt: label?.computed_at ?? null,
    isStale: label?.is_stale ?? null,
    blocked: !!missing?.blocked || checklistBlocked,
  });

  const declarationManual = ((recipe.declaration_mode as DeclarationMode | null) ?? "auto") === "manual";
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

  if (labelQuery.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LabelStatusBar
        computedAt={label?.computed_at}
        coveragePct={coveragePct}
        declarationManual={declarationManual}
        breadscaleManual={breadscaleMode === "manual"}
        linkedProducts={links}
        canWrite={canWrite}
        computing={compute.isPending}
        onRecompute={recompute}
        status={status}
        approvedAt={approvedAt}
        approvedByName={approverQuery.data ?? null}
        staleSourceName={label?.stale_reason ?? null}
        staleSourceAt={null}
        allergenReviewed={(missing?.allergens_unreviewed?.length ?? 0) === 0}
        declarationNamed={(missing?.declaration_names?.length ?? 0) === 0}
        approving={approve.isPending}
        onApprove={() => setApproveOpen(true)}
      />

      <ApproveDeclarationDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        currentMode={declarationManual ? "manual" : "auto"}
        blocked={checklistBlocked}
        saving={approve.isPending}
        calculated={{
          ingredientText: label?.ingredient_declaration ?? null,
          contains: label?.allergens?.contains ?? [],
          mayContain: label?.allergens?.may_contain ?? [],
          nutrition: (label?.nutrition_per_100g ?? null) as Record<string, number | null> | null,
        }}
        manual={manualSource}
        onApprove={(mode, adopt) =>
          approve.mutate(
            {
              recipeId,
              source: mode === "manual" ? "manual" : "calculated",
              // Skrives til recipes.label_claim_* før RPC-en leser dem.
              claims: { grain: !!recipe.label_claim_grain, keyhole: !!recipe.label_claim_keyhole },
              // p_overrides sendes alltid – tomt objekt når ingenting overstyres.
              overrides: adopt
                ? {
                    ingredient_text: adopt.ingredientText,
                    allergens_contains: adopt.contains,
                    allergens_may_contain: adopt.mayContain,
                    nutrition_per_100g: adopt.nutrition,
                  }
                : {},
            },
            { onSuccess: () => setApproveOpen(false) },
          )
        }
      />

      <DataQualityCard
        coveragePct={coveragePct}
        missingData={(label?.missing_data ?? null) as MissingData | null}
        warnings={label?.warnings ?? null}
        onRecalculate={recompute}
        recalculating={compute.isPending}
        canWrite={canWrite}
        onGoToRecipeTab={onGoToRecipeTab}
        recipeId={recipeId}
      />

      <DeclarationNutritionSection
        recipeId={recipeId}
        recipe={recipe}
        calculated={label}
        canWrite={canWrite}
        linkedProductCount={links.length}
        computing={compute.isPending}
        onRecompute={recompute}
      />

      <GrainSection
        recipeId={recipeId}
        breadscaleMode={breadscaleMode}
        manualPct={recipe.manual_breadscale_pct ?? null}
        claimGrain={!!recipe.label_claim_grain}
        approvedAt={recipe.label_claims_approved_at ?? null}
        approvedBy={recipe.label_claims_approved_by ?? null}
        grainPct={label?.grain_score_pct ?? null}
        grainCategory={label?.grain_category ?? null}
        flourGrams={label?.flour_grams ?? null}
        coarseWeightedGrams={label?.lines?.coarse_weighted_grams ?? null}
        wholeGrainPctOfDry={label?.whole_grain_pct_of_dry ?? null}
        dryMatterPct={label?.dry_matter_pct ?? null}
        finalWeightGrams={label?.final_weight_grams ?? null}
        warnings={label?.warnings ?? null}
        flourLines={flourLines}
        canWrite={canWrite}
        savingClaim={saveClaim.isPending}
        onToggleClaim={(value) => saveClaim.mutate({ field: "label_claim_grain", value })}
      />

      <KeyholeSection
        keyhole={keyhole}
        coverageOk={coverageOk}
        claimKeyhole={!!recipe.label_claim_keyhole}
        approvedBy={recipe.label_claims_approved_by ?? null}
        approvedAt={recipe.label_claims_approved_at ?? null}
        canWrite={canWrite}
        saving={saveClaim.isPending}
        primaryProductCount={primaryCount}
        onToggleClaim={(value) => saveClaim.mutate({ field: "label_claim_keyhole", value })}
      />

      <LabelInfoCard
        recipeId={recipeId}
        unitWeightGrams={recipe.unit_weight_grams ?? null}
        shelfLifeDays={recipe.shelf_life_days ?? null}
        storageInstructions={recipe.storage_instructions ?? null}
        countryOfOrigin={recipe.country_of_origin ?? null}
        canWrite={canWrite}
      />

      <ConsumerLabelSection
        recipeName={recipeName}
        effective={effective}
        effectiveGrainPct={
          effectiveGrain.data ?? (breadscaleMode === "manual" ? recipe.manual_breadscale_pct ?? null : label?.grain_score_pct ?? null)
        }
        declarationManual={declarationManual}
        breadscaleManual={breadscaleMode === "manual"}
        claimGrain={!!recipe.label_claim_grain}
        claimKeyhole={!!recipe.label_claim_keyhole}
        unitWeightGrams={recipe.unit_weight_grams ?? null}
        shelfLifeDays={recipe.shelf_life_days ?? null}
        storageInstructions={recipe.storage_instructions ?? null}
        countryOfOrigin={recipe.country_of_origin ?? null}
        entity={entityQuery.data ?? null}
        profile={labelProfileQuery.data ?? null}
        blocked={!!missing?.blocked}
        keyholeQualifies={keyhole?.status === "oppfylt"}
        coveragePct={coveragePct}
        onChecklistChange={onChecklistChange}
        nutritionUsable={declarationManual ? !!effective.nutrition : coverageOk && !!effective.nutrition}
      />

      <LinkedProductsCard recipeId={recipeId} links={links} canWrite={canWrite} />
    </div>
  );
}
