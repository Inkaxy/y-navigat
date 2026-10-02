import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useApproveDeclaration, useRecipeDeclarationVersions } from "@/varer/hooks/useLabelApproval";
import { useRecipeLabelProfile } from "@/varer/hooks/useRecipeLabelProfile";
import { useUserDisplayName } from "@/varer/hooks/useRecipeLabel";
import { checkState, deriveLabelState, deriveNextAction, fixTargetForChecklistKey } from "@/varer/lib/labelWorkspace";
import type { LabelSource } from "./labelShared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsDesktop } from "@/varer/hooks/useIsDesktop";
import { parseAllergenSummary, pickNutrition, type NutritionPer100g } from "@/varer/lib/effectiveDeclaration";
import { ApproveDeclarationDialog, type ApproveSourceData } from "./ApproveDeclarationDialog";
import { LabelSummaryPanel } from "./LabelSummaryPanel";

type LabelSection = "deklarasjon" | "datakvalitet" | "etikett" | "merker";
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
  const [section, setSection] = useState<LabelSection>("deklarasjon");
  const isDesktop = useIsDesktop();

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
  const producerAddress = entity
    ? [entity.address_line1, [entity.postal_code, entity.city].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : null;

  /**
   * Pliktfeltene vurderes per kilde. En sperret beregning skal ikke hindre
   * godkjenning av en komplett manuell deklarasjon.
   */
  const approveIssues = useMemo(() => {
    const issuesFor = (src: ApproveSourceData, isManual: boolean) =>
      buildLabelChecklist({
        productName: recipeName,
        ingredientText: declarationDisplayText(src.ingredientText) || null,
        contains: src.contains,
        mayContain: src.mayContain,
        netWeightGrams: recipe.unit_weight_grams ?? null,
        shelfLifeDays: recipe.shelf_life_days ?? null,
        storageInstructions: recipe.storage_instructions ?? null,
        producerName: entity?.name ?? null,
        producerAddress: producerAddress || null,
        nutrition: isManual ? src.nutrition : coverageOk ? src.nutrition : null,
        coveragePct: isManual ? null : coveragePct,
        blocked: isManual ? false : !!missing?.blocked,
        claimGrain: !!recipe.label_claim_grain,
        grainPct: label?.grain_score_pct ?? null,
        claimKeyhole: !!recipe.label_claim_keyhole,
        keyholeQualifies: keyhole?.status === "oppfylt",
      })
        // Godkjenningen gjelder deklarasjon og næringsinnhold. Nettovekt,
        // holdbarhet, produsent og allergenpresentasjon kontrolleres fortsatt
        // i etikettkontrollen, men skal ikke sperre et gyldig manuelt snapshot.
        .errors.filter((e) => e.key === "ingredients" || e.key === "nutrition")
        .map((e) => `${e.label}: ${e.detail}`);
    return {
      auto: issuesFor(
        {
          ingredientText: label?.ingredient_declaration ?? null,
          contains: label?.allergens?.contains ?? [],
          mayContain: label?.allergens?.may_contain ?? [],
          nutrition: (label?.nutrition_per_100g ?? null) as Record<string, number | null> | null,
        },
        false,
      ),
      manual: issuesFor(manualSource, true),
    };
  }, [
    coverageOk,
    coveragePct,
    entity,
    keyhole,
    label,
    manualSource,
    missing,
    producerAddress,
    recipe.label_claim_grain,
    recipe.label_claim_keyhole,
    recipe.shelf_life_days,
    recipe.storage_instructions,
    recipe.unit_weight_grams,
    recipeName,
  ]);

  const sourceIssues = declarationManual ? approveIssues.manual : approveIssues.auto;
  const nextAction = deriveNextAction({ state: labelState, approveIssues: sourceIssues });
  const keyholeRelevant = recipe.label_claim_keyhole || keyhole?.status === "oppfylt";
  const grainRelevant = !!recipe.label_claim_grain || (label?.grain_score_pct ?? null) != null;

  const goTo = (s: LabelSection, anchor?: string) => {
    setSection(s);
    if (anchor) {
      window.setTimeout(() => {
        const el = document.getElementById(anchor);
        el?.scrollIntoView({ block: "start" });
        el?.focus({ preventScroll: true });
      }, 50);
    }
  };

  const onNextAction = () => {
    if (nextAction === "compute") recompute();
    else if (nextAction === "show_missing") {
      setQualitySignal((n) => n + 1);
      goTo("datakvalitet", "merking-datakvalitet");
    }
    else setApproveOpen(true);
  };

  const onFixField = (key: string) => {
    const t = fixTargetForChecklistKey(key, declarationManual);
    if (!t) return;
    if (t.section === "deklarasjon") setCandidate(savedSource);
    if (t.section === "datakvalitet") setQualitySignal((n) => n + 1);
    goTo(t.section, t.anchor);
  };

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

  const preview = (
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
      blocked={declarationManual ? false : !!missing?.blocked}
      keyholeQualifies={keyhole?.status === "oppfylt"}
      coveragePct={coveragePct}
      onChecklistChange={onChecklistChange}
      fixLabelFor={(key) => fixTargetForChecklistKey(key, declarationManual)?.label ?? null}
      onFixField={onFixField}
      nutritionUsable={declarationManual ? !!effective.nutrition : coverageOk && !!effective.nutrition}
    />
  );

  const previewNote = (
    <p className="text-xs text-muted-foreground">
      Forhåndsvisningen viser lagret kilde ({declarationManual ? "manuell" : "beregnet"}). Ulagrede endringer i
      redigeringsfeltene vises ikke her og påvirker ikke utskrift eller API.
    </p>
  );

  const tabContentClass = "mt-4 space-y-4 data-[state=inactive]:hidden";

  return (
    <div className="space-y-4">
      <LabelSummaryPanel
        state={labelState}
        computedAt={label?.computed_at ?? null}
        coveragePct={coveragePct}
        declarationManual={declarationManual}
        breadscaleManual={breadscaleMode === "manual"}
        approvedAt={approvedAt}
        approvedByName={approverQuery.data ?? null}
        staleReason={label?.stale_reason ?? null}
        linkedCount={links.length}
        allergenCheck={checkState(hasCalc, missing ? missing.allergens_unreviewed?.length ?? 0 : null)}
        nameCheck={checkState(hasCalc, missing ? missing.declaration_names?.length ?? 0 : null)}
        sourceIssues={sourceIssues}
        nextAction={nextAction}
        canWrite={canWrite}
        computing={compute.isPending}
        approving={approve.isPending}
        onNextAction={onNextAction}
        onRecompute={recompute}
        onShowLinked={() => goTo("deklarasjon", "merking-koblede-varer")}
      />

      <ApproveDeclarationDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        currentMode={candidate}
        issues={approveIssues}
        manualDirty={manualDirty}
        previous={
          latestVersion
            ? {
                version: latestVersion.version,
                approvedAt: latestVersion.approved_at,
                source: latestVersion.source,
                doc: {
                  ingredientText: latestVersion.ingredient_text,
                  contains: latestVersion.allergens_contains ?? [],
                  mayContain: latestVersion.allergens_may_contain ?? [],
                  nutrition: (latestVersion.nutrition_per_100g ?? null) as Record<string, number | null> | null,
                },
              }
            : null
        }
        affected={links.map((l) => ({
          id: l.product_id,
          name: l.products?.display_name ?? "Uten navn",
          number: l.products?.display_number ?? null,
        }))}
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
              claims: { grain: !!recipe.label_claim_grain, keyhole: !!recipe.label_claim_keyhole },
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
        <Tabs value={section} onValueChange={(v) => setSection(v as LabelSection)} className="min-w-0">
          <TabsList aria-label="Deler av merkingen" className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="deklarasjon">Deklarasjon</TabsTrigger>
            <TabsTrigger value="datakvalitet">Datakvalitet</TabsTrigger>
            <TabsTrigger value="etikett">Etikett</TabsTrigger>
            <TabsTrigger value="merker">Merker</TabsTrigger>
          </TabsList>

          <TabsContent value="deklarasjon" forceMount className={tabContentClass}>
            <DeclarationNutritionSection
              recipeId={recipeId}
              recipe={recipe}
              calculated={label}
              canWrite={canWrite}
              linkedProductCount={links.length}
              computing={compute.isPending}
              onRecompute={recompute}
              candidate={candidate}
              onCandidateChange={setCandidate}
              approvedManualActive={declarationManual && labelState === "approved"}
              onDirtyChange={setManualDirty}
              onOpenApprove={() => setApproveOpen(true)}
            />
            <div id="merking-koblede-varer" tabIndex={-1} className="scroll-mt-4 outline-none">
              <LinkedProductsCard recipeId={recipeId} links={links} canWrite={canWrite} />
            </div>
          </TabsContent>

          <TabsContent value="datakvalitet" forceMount className={tabContentClass}>
            <div id="merking-datakvalitet" tabIndex={-1} className="scroll-mt-4 outline-none">
              <DataQualityCard
                coveragePct={coveragePct}
                missingData={missing}
                warnings={label?.warnings ?? null}
                onRecalculate={recompute}
                recalculating={compute.isPending}
                canWrite={canWrite}
                onGoToRecipeTab={onGoToRecipeTab}
                recipeId={recipeId}
                openSignal={qualitySignal}
              />
            </div>
          </TabsContent>

          <TabsContent value="etikett" forceMount className={tabContentClass}>
            <LabelInfoCard
              recipeId={recipeId}
              unitWeightGrams={recipe.unit_weight_grams ?? null}
              shelfLifeDays={recipe.shelf_life_days ?? null}
              storageInstructions={recipe.storage_instructions ?? null}
              countryOfOrigin={recipe.country_of_origin ?? null}
              canWrite={canWrite}
            />
            {!isDesktop && (
              <>
                {previewNote}
                {preview}
              </>
            )}
          </TabsContent>

          <TabsContent value="merker" forceMount className={tabContentClass}>
            <details id="merking-grovhet" open={grainRelevant} className="group scroll-mt-4 rounded-lg border bg-card">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
                Grovhet / Brødskala&apos;n
                {!grainRelevant && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    — ikke beregnet for denne oppskriften. Åpne for detaljer.
                  </span>
                )}
              </summary>
              <div className="p-2 pt-0">
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
              </div>
            </details>
            <details id="merking-nokkelhull" open={!!keyholeRelevant} className="group scroll-mt-4 rounded-lg border bg-card">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">
                Nøkkelhullet
                {!keyholeRelevant && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    — {!keyhole ? "ingen vurdering ennå" : keyhole.status === "ukjent" ? "kan ikke vurderes ennå" : "kriteriene er ikke oppfylt, ikke aktuelt å merke"}. Åpne
                    for detaljer.
                  </span>
                )}
              </summary>
              <div className="p-2 pt-0">
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
              </div>
            </details>
          </TabsContent>
        </Tabs>

        {isDesktop && (
          <aside aria-label="Etikettforhåndsvisning" className="space-y-2 lg:sticky lg:top-4 lg:self-start">
            {previewNote}
            {preview}
          </aside>
        )}
      </div>
    </div>
  );
}
