/**
 * Felles oppsett av etikettkontrollen for oppskriftens kladd.
 *
 * Merkefanens forhåndsvisning («Rett dette før utskrift») og «Gjenstår» på
 * oppskriftssiden skal vise nøyaktig de samme pliktfeltene. Begge bygger derfor
 * inndataene til `buildLabelChecklist` her, fra de samme verdiene.
 */
import type { EffectiveDeclaration } from "@/varer/lib/effectiveDeclaration";
import type { LabelChecklistInput } from "@/varer/lib/labelChecklist";

export interface LabelEntityInfo {
  name: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
}

/** «Gateadresse, postnr sted» — tom streng når ingenting er registrert. */
export function labelProducerAddress(entity: LabelEntityInfo | null | undefined): string {
  if (!entity) return "";
  return [entity.address_line1, [entity.postal_code, entity.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

/** Sperre, næringsbruk og grovhet for kladden — samme regler som merkefanen. */
export function draftLabelFlags(input: {
  declarationManual: boolean;
  coveragePct: number | null;
  calculationBlocked: boolean;
  hasNutrition: boolean;
  /** `recipe_breadscale_effective`; null eller udefinert faller tilbake. */
  effectiveGrainPct: number | null | undefined;
  breadscaleManual: boolean;
  manualBreadscalePct: number | null;
  calculatedGrainPct: number | null;
}): { coverageOk: boolean; blocked: boolean; nutritionUsable: boolean; grainPct: number | null } {
  const coverageOk = (input.coveragePct ?? 0) >= 90;
  return {
    coverageOk,
    blocked: input.declarationManual ? false : input.calculationBlocked,
    nutritionUsable: input.declarationManual ? input.hasNutrition : coverageOk && input.hasNutrition,
    grainPct:
      input.effectiveGrainPct ?? (input.breadscaleManual ? input.manualBreadscalePct : input.calculatedGrainPct),
  };
}

export interface LabelChecklistSource {
  recipeName: string;
  effective: Pick<EffectiveDeclaration, "ingredientText" | "contains" | "mayContain" | "nutrition">;
  effectiveGrainPct: number | null;
  declarationManual: boolean;
  claimGrain: boolean;
  claimKeyhole: boolean;
  unitWeightGrams: number | null;
  shelfLifeDays: number | null;
  storageInstructions: string | null;
  entity: LabelEntityInfo | null;
  nutritionUsable: boolean;
  blocked?: boolean;
  keyholeQualifies?: boolean;
  coveragePct?: number | null;
}

/** Inndata til `buildLabelChecklist` slik etikettforhåndsvisningen bruker dem. */
export function labelChecklistInput(p: LabelChecklistSource): LabelChecklistInput {
  const address = labelProducerAddress(p.entity);
  return {
    productName: p.recipeName,
    ingredientText: p.effective.ingredientText,
    contains: p.effective.contains,
    mayContain: p.effective.mayContain,
    netWeightGrams: p.unitWeightGrams,
    shelfLifeDays: p.shelfLifeDays,
    storageInstructions: p.storageInstructions,
    producerName: p.entity?.name ?? null,
    producerAddress: address || null,
    nutrition: p.nutritionUsable ? (p.effective.nutrition as Record<string, number | null> | null) : null,
    coveragePct: p.declarationManual ? null : p.coveragePct ?? null,
    blocked: p.blocked,
    claimGrain: p.claimGrain,
    grainPct: p.effectiveGrainPct,
    claimKeyhole: p.claimKeyhole,
    keyholeQualifies: p.keyholeQualifies,
  };
}
