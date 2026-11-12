/**
 * Sperrene for godkjenning per kilde (beregnet / manuell), flyttet fra
 * merkefanen. Godkjenningen gjelder deklarasjon og næringsinnhold: nettovekt,
 * holdbarhet og produsent kontrolleres i etikettkontrollen, men sperrer ikke
 * et gyldig snapshot. For manuell kilde sperrer i tillegg allergener fra
 * råvarene som mangler eller står uten fremheving (art. 21).
 */
import { buildLabelChecklist } from "@/varer/lib/labelChecklist";
import { declarationDisplayText } from "@/varer/lib/effectiveDeclaration";
import { checkManualAllergens, manualAllergenIssues } from "@/varer/lib/manualAllergenCheck";

export interface ApproveSourceDoc {
  ingredientText: string | null;
  contains: string[];
  mayContain: string[];
  nutrition: Record<string, number | null> | null;
}

export interface LabelApproveIssuesInput {
  recipeName: string;
  calculated: ApproveSourceDoc;
  manual: ApproveSourceDoc;
  netWeightGrams: number | null;
  shelfLifeDays: number | null;
  storageInstructions: string | null;
  producerName: string | null;
  producerAddress: string | null;
  coveragePct: number | null;
  calculationBlocked: boolean;
  claimGrain: boolean;
  grainPct: number | null;
  claimKeyhole: boolean;
  keyholeQualifies: boolean;
  /** Allergenene fra råvarene (beregnet), eller null når det ikke er beregnet. */
  knownAllergens: string[] | null;
}

export function labelApproveIssues(i: LabelApproveIssuesInput): { auto: string[]; manual: string[] } {
  const coverageOk = (i.coveragePct ?? 0) >= 90;
  const issuesFor = (src: ApproveSourceDoc, isManual: boolean) =>
    buildLabelChecklist({
      productName: i.recipeName,
      ingredientText: declarationDisplayText(src.ingredientText) || null,
      contains: src.contains,
      mayContain: src.mayContain,
      netWeightGrams: i.netWeightGrams,
      shelfLifeDays: i.shelfLifeDays,
      storageInstructions: i.storageInstructions,
      producerName: i.producerName,
      producerAddress: i.producerAddress,
      nutrition: isManual ? src.nutrition : coverageOk ? src.nutrition : null,
      coveragePct: isManual ? null : i.coveragePct,
      blocked: isManual ? false : i.calculationBlocked,
      claimGrain: i.claimGrain,
      grainPct: i.grainPct,
      claimKeyhole: i.claimKeyhole,
      keyholeQualifies: i.keyholeQualifies,
    })
      .errors.filter((e) => e.key === "ingredients" || e.key === "nutrition")
      .map((e) => `${e.label}: ${e.detail}`);
  const allergenErrors = manualAllergenIssues({
    check: checkManualAllergens(i.manual.ingredientText, i.knownAllergens),
  }).errors.map((e) => `Allergener: ${e}`);
  return { auto: issuesFor(i.calculated, false), manual: [...issuesFor(i.manual, true), ...allergenErrors] };
}
