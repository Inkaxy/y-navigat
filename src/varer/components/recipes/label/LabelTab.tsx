import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLegalEntityLabelInfo } from "@/varer/hooks/useLegalEntityLabelInfo";
import { draftLabelFlags, labelProducerAddress } from "@/varer/lib/recipeLabelIssues";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useComputeRecipeLabel,
  useRecipeBreadscaleEffective,
  useRecipeLabelCalculated,
  useRecipeLinkedProducts,
} from "@/varer/hooks/useRecipeLabel";
import type { FlourLine } from "@/varer/lib/breadscale";
import {
  buildEffectiveDeclaration,
  declarationDisplayText,
  type DeclarationMode,
  type RecipeLabelSnapshot,
} from "@/varer/lib/effectiveDeclaration";
import { buildLabelChecklist } from "@/varer/lib/labelChecklist";
import { labelApproveIssues } from "@/varer/lib/labelApproveIssues";
import { grainClaimState, keyholeClaimState } from "@/varer/lib/labelClaims";
import { labelChecklistInput } from "@/varer/lib/recipeLabelIssues";
import type { RecipeBasisInput } from "@/varer/lib/recipeLinkBasis";
import { useApproveDeclaration, useRecipeDeclarationVersions } from "@/varer/hooks/useLabelApproval";
import { useRecipeLabelProfile } from "@/varer/hooks/useRecipeLabelProfile";
import { useUserDisplayName } from "@/varer/hooks/useRecipeLabel";
import { checkState, deriveLabelState, deriveNextAction, fixTargetForChecklistKey } from "@/varer/lib/labelWorkspace";
import type { LabelSource } from "./labelShared";
import { parseAllergenSummary, pickNutrition, type NutritionPer100g } from "@/varer/lib/effectiveDeclaration";
import { ApproveDeclarationDialog, type ApproveSourceData } from "./ApproveDeclarationDialog";
import { LabelSummaryPanel } from "./LabelSummaryPanel";

import { DataQualityCard, type MissingData } from "./DataQualityCard";
import { DeclarationNutritionSection } from "./DeclarationNutritionSection";
import { GrainSection } from "./GrainSection";
import { KeyholeSection, type KeyholeResult } from "./KeyholeSection";
import { approvedLabelInput } from "@/varer/lib/approvedLabel";
import { LinkedProductsCard } from "./LinkedProductsCard";
import { LabelFieldsCard } from "./LabelFieldsCard";
import { LabelMarksCard } from "./LabelMarksCard";
import { LabelPreviewPanel } from "./LabelPreviewPanel";

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

interface Props {
  recipeId: string;
  recipeName: string;
  recipe: LabelRecipe;
  flourLines: FlourLine[];
  legalEntityId: string | undefined;
  canWrite: boolean;
  /** Bytter til Oppskrift-fanen (brukes av datakvalitet-kortet). */
  onGoToRecipeTab?: () => void;
  /**
   * Fokusforespørsel fra «Gjenstår»: en nøkkel fra etikettkontrollen eller
   * «datakvalitet». Ny `seq` gir nytt fokus også for samme nøkkel.
   */
  fixRequest?: { key: string; seq: number } | null;
  /** Oppskriftens utbytte (emner, deig- og ferdigvekt) — bare til forslag om nettovekt per vare. */
  basisInput?: RecipeBasisInput | null;
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
  fixRequest,
  basisInput = null,
}: Props) {
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
  const [approveOpen, setApproveOpen] = useState(false);
  const [checklistBlocked, setChecklistBlocked] = useState(false);
  const onChecklistChange = useCallback((v: boolean) => setChecklistBlocked(v), []);

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
  const [candidate, setCandidate] = useState<LabelSource>(savedSource);
  useEffect(() => setCandidate(savedSource), [savedSource]);
  const [manualDirty, setManualDirty] = useState(false);
  const [qualitySignal, setQualitySignal] = useState(0);
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
  /** Én side: snarveiene ruller til kortet eller feltet. */
  const goTo = (anchor: string) => {
    window.setTimeout(() => {
      const el = document.getElementById(anchor);
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
    }, 50);
  };
  const showQuality = () => {
    setQualitySignal((n) => n + 1);
    goTo("merking-datakvalitet");
  };

  const onNextAction = () => {
    if (nextAction === "compute") recompute();
    else if (nextAction === "show_missing") {
      if (declarationManual) {
        setCandidate(savedSource);
        goTo("merking-editor");
      } else showQuality();
    } else setApproveOpen(true);
  };

  const onFixField = (key: string) => {
    const t = fixTargetForChecklistKey(key, declarationManual);
    if (!t) return;
    if (t.section === "deklarasjon") setCandidate(savedSource);
    if (t.section === "datakvalitet") setQualitySignal((n) => n + 1);
    goTo(t.anchor);
  };

  // Klikk i «Gjenstår» på oppskriftssiden: samme snarvei som «Rett felt».
  const fixSeq = fixRequest?.seq ?? 0;
  const fixKey = fixRequest?.key ?? null;
  const fixRef = useRef<(key: string) => void>(() => undefined);
  fixRef.current = (key: string) => {
    if (key === "datakvalitet") return showQuality();
    if (fixTargetForChecklistKey(key, declarationManual)) onFixField(key);
    else goTo("merking-pliktfelt");
  };
  useEffect(() => {
    if (fixSeq > 0 && fixKey) fixRef.current(fixKey);
  }, [fixSeq, fixKey]);

  if (labelQuery.isLoading || versionsQuery.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Laster merkedata">
        <div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      </div>
    );
  }

  if (labelQuery.isError || versionsQuery.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
        Kunne ikke hente merkedata.
        <button type="button" className="font-medium underline" onClick={() => {
            void labelQuery.refetch();
            void versionsQuery.refetch();
          }}>
          Prøv igjen
        </button>
      </div>
    );
  }

