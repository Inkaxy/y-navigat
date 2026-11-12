import { useCallback, useEffect, useRef, useState } from "react";
import type { FlourLine } from "@/varer/lib/breadscale";
import type { DeclarationMode } from "@/varer/lib/effectiveDeclaration";
import { buildLabelChecklist } from "@/varer/lib/labelChecklist";
import { grainClaimState, keyholeClaimState } from "@/varer/lib/labelClaims";
import { draftLabelFlags, labelChecklistInput } from "@/varer/lib/recipeLabelIssues";
import type { RecipeBasisInput } from "@/varer/lib/recipeLinkBasis";
import { checkState, fixTargetForChecklistKey } from "@/varer/lib/labelWorkspace";
import { approvedLabelInput } from "@/varer/lib/approvedLabel";
import { useLabelTabData } from "@/varer/hooks/useLabelTabData";
import type { LabelSource } from "./labelShared";
import { LabelApproveHost } from "./LabelApproveHost";
import { LabelSummaryPanel } from "./LabelSummaryPanel";
import { DataQualityCard } from "./DataQualityCard";
import { DeclarationNutritionSection } from "./DeclarationNutritionSection";
import { GrainSection } from "./GrainSection";
import { KeyholeSection } from "./KeyholeSection";
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
  const d = useLabelTabData(recipeId, recipeName, recipe, legalEntityId);
  const {
    labelQuery, compute, effectiveGrain, saveClaim, labelProfileQuery, approve, label, coveragePct, coverageOk,
    keyhole, links, primaryCount, versionsQuery, latestVersion, approvedAt, approverQuery, missing, labelState,
    hasCalc, declarationManual, savedSource, breadscaleMode, recompute, effective, manualSource, entity,
    approveIssues, sourceIssues, nextAction,
  } = d;
  const [approveOpen, setApproveOpen] = useState(false);
  const [, setChecklistBlocked] = useState(false);
  const onChecklistChange = useCallback((v: boolean) => setChecklistBlocked(v), []);
  const [candidate, setCandidate] = useState<LabelSource>(savedSource);
  useEffect(() => setCandidate(savedSource), [savedSource]);
  const [manualDirty, setManualDirty] = useState(false);
  const [qualitySignal, setQualitySignal] = useState(0);

  /** Én side: snarveiene ruller til kortet eller feltet. */
  const goTo = (anchor: string, attempt = 0) => {
    window.setTimeout(() => {
      const el = document.getElementById(anchor);
      // Kortene kan fortsatt laste når snarveien kommer fra en annen fane.
      if (!el) {
        if (attempt < 20) goTo(anchor, attempt + 1);
        return;
      }
      el.scrollIntoView({ block: "start" });
      el.focus({ preventScroll: true });
    }, attempt === 0 ? 50 : 100);
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

  const approvedInput = latestVersion ? approvedLabelInput(latestVersion) : null;
  const breadscaleManual = breadscaleMode === "manual";
  // Samme regler som «Gjenstår» (draftLabelFlags).
  const draftFlags = draftLabelFlags({
    declarationManual,
    coveragePct,
    calculationBlocked: !!missing?.blocked,
    hasNutrition: !!effective.nutrition,
    effectiveGrainPct: effectiveGrain.data,
    breadscaleManual,
    manualBreadscalePct: recipe.manual_breadscale_pct ?? null,
    calculatedGrainPct: label?.grain_score_pct ?? null,
  });
  const draftLabel = {
    recipeName,
    effective,
    effectiveGrainPct: draftFlags.grainPct,
    declarationManual,
    claimGrain: !!recipe.label_claim_grain,
    claimKeyhole: !!recipe.label_claim_keyhole,
    unitWeightGrams: recipe.unit_weight_grams ?? null,
    shelfLifeDays: recipe.shelf_life_days ?? null,
    storageInstructions: recipe.storage_instructions ?? null,
    entity,
    nutritionUsable: draftFlags.nutritionUsable,
    blocked: draftFlags.blocked,
    keyholeQualifies: keyhole?.status === "oppfylt",
    coveragePct,
  };
  // Kladdens sjekkliste — den samme som forhåndsvisningen og «Gjenstår» bygger.
  const draftChecklist = buildLabelChecklist(labelChecklistInput(draftLabel)).items;
  const showChecklist = () => goTo("merking-pliktfelt");
  const grainClaim = grainClaimState({ breadscaleMode, manualPct: recipe.manual_breadscale_pct ?? null, grainPct: label?.grain_score_pct ?? null });
  const keyholeClaim = keyholeClaimState({ coverageOk, status: keyhole?.status });
  const toggleClaim = (field: "label_claim_keyhole" | "label_claim_grain", value: boolean) => saveClaim.mutate({ field, value });

  return (
    <div className="space-y-4">
      <LabelApproveHost
        open={approveOpen}
        onOpenChange={setApproveOpen}
        recipeId={recipeId}
        candidate={candidate}
        manualDirty={manualDirty}
        data={d}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="min-w-0 space-y-4">
          <LabelSummaryPanel
            state={labelState}
            computedAt={label?.computed_at ?? null}
            coveragePct={coveragePct}
            declarationManual={declarationManual}
            breadscaleManual={breadscaleManual}
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
            onShowLinked={() => goTo("merking-koblede-varer")}
          />

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
            onShowQuality={showQuality}
            unreviewedAllergenCount={missing?.allergens_unreviewed?.length ?? 0}
            qualitySlot={
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
                  autoOpen
                />
              </div>
            }
          />

          <LabelFieldsCard
            recipeId={recipeId}
            checklist={draftChecklist}
            values={{
              unitWeightGrams: recipe.unit_weight_grams ?? null,
              shelfLifeDays: recipe.shelf_life_days ?? null,
              storageInstructions: recipe.storage_instructions ?? null,
              countryOfOrigin: recipe.country_of_origin ?? null,
            }}
            canWrite={canWrite}
            fixLabelFor={(key) => fixTargetForChecklistKey(key, declarationManual)?.label ?? null}
            onFixField={onFixField}
          />

          <div id="merking-koblede-varer" tabIndex={-1} className="scroll-mt-4 outline-none">
            <LinkedProductsCard recipeId={recipeId} links={links} canWrite={canWrite} basisInput={basisInput} />
          </div>

          <LabelMarksCard
            canWrite={canWrite}
            saving={saveClaim.isPending}
            onToggleClaim={toggleClaim}
            links={links}
            grain={{
              claim: !!recipe.label_claim_grain,
              effectivePct: grainClaim.effectivePct,
              manual: breadscaleManual,
              locked: grainClaim.locked,
              lockedReason: grainClaim.reason,
              details: (
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
                  onToggleClaim={(value) => toggleClaim("label_claim_grain", value)}
                  showClaimToggle={false}
                />
              ),
            }}
            keyhole={{
              claim: !!recipe.label_claim_keyhole,
              result: keyhole,
              locked: keyholeClaim.locked,
              lockedReason: keyholeClaim.reason,
              details: (
                <KeyholeSection
                  keyhole={keyhole}
                  coverageOk={coverageOk}
                  claimKeyhole={!!recipe.label_claim_keyhole}
                  approvedBy={recipe.label_claims_approved_by ?? null}
                  approvedAt={recipe.label_claims_approved_at ?? null}
                  canWrite={canWrite}
                  saving={saveClaim.isPending}
                  primaryProductCount={primaryCount}
                  onToggleClaim={(value) => toggleClaim("label_claim_keyhole", value)}
                  showClaimToggle={false}
                />
              ),
            }}
          />
        </div>

        <aside aria-label="Etikett" className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
          <LabelPreviewPanel
            declarationManual={declarationManual}
            approved={
              approvedInput && latestVersion
                ? {
                    version: latestVersion.version,
                    props: {
                      variant: "approved",
                      approvedVersion: latestVersion.version,
                      recipeName,
                      effective: approvedInput.effective,
                      effectiveGrainPct: approvedInput.grainPct,
                      declarationManual,
                      breadscaleManual,
                      claimGrain: approvedInput.claimGrain,
                      claimKeyhole: approvedInput.claimKeyhole,
                      unitWeightGrams: approvedInput.unitWeightGrams,
                      shelfLifeDays: approvedInput.shelfLifeDays,
                      storageInstructions: approvedInput.storageInstructions,
                      countryOfOrigin: approvedInput.countryOfOrigin,
                      entity,
                      profile: labelProfileQuery.data ?? null,
                      blocked: false,
                      keyholeQualifies: approvedInput.claimKeyhole,
                      coveragePct: approvedInput.effective.coveragePct,
                      nutritionUsable: approvedInput.nutritionUsable,
                      onShowChecklist: showChecklist,
                    },
                  }
                : null
            }
            draft={{
              ...draftLabel,
              variant: "draft",
              breadscaleManual,
              countryOfOrigin: recipe.country_of_origin ?? null,
              profile: labelProfileQuery.data ?? null,
              onChecklistChange,
              onShowChecklist: showChecklist,
            }}
          />
        </aside>
      </div>
    </div>
  );
}
