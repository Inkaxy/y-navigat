/**
 * Arbeidsflate-status for Merking. Skiller beregningsaktualitet fra
 * godkjenning, og konstruerer aldri «OK» fra en tom eller ulastet liste.
 */

export type LabelState = "not_computed" | "computed" | "approved" | "stale";

export interface LabelStateInput {
  computedAt: string | null | undefined;
  isStale: boolean | null | undefined;
  approvedAt: string | null | undefined;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Samme grunnlag som varelisten (`deriveLabelingStatusFromDb`), men uten å
 * blande inn sperrer: en eksisterende godkjenning vises aldri som «aldri godkjent».
 */
export function deriveLabelState(input: LabelStateInput): LabelState {
  const approved = ms(input.approvedAt);
  const computed = ms(input.computedAt);
  if (approved != null) {
    if (input.isStale) return "stale";
    if (computed != null && approved < computed) return "stale";
    return "approved";
  }
  if (computed == null) return "not_computed";
  return "computed";
}

export const LABEL_STATE_LABEL: Record<LabelState, string> = {
  not_computed: "Ikke beregnet",
  computed: "Beregnet – ikke godkjent",
  approved: "Godkjent",
  stale: "Utdatert",
};

/** Tri-state for kontroller: «ukjent» når beregning ikke finnes. */
export type CheckState = "unknown" | "ok" | "missing";

export function checkState(computed: boolean, count: number | null | undefined): CheckState {
  if (!computed || count == null) return "unknown";
  return count === 0 ? "ok" : "missing";
}

export type NextAction = "compute" | "show_missing" | "review";

export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  compute: "Beregn merkedata",
  show_missing: "Se hva som mangler",
  review: "Se gjennom og godkjenn",
};

/**
 * Én primær neste handling. `approveIssues` er sperrene for den kilden som er
 * lagret som gjeldende — samme validator som godkjenningsdialogen bruker.
 */
export function deriveNextAction(input: {
  state: LabelState;
  approveIssues: string[];
}): NextAction {
  if (input.state === "not_computed") return "compute";
  if (input.approveIssues.length > 0) return "show_missing";
  return "review";
}

/** Hvor et pliktfelt fra etikettkontrollen rettes i Merking. */
export type FixTarget =
  | { section: "deklarasjon"; anchor: string; label: string }
  | { section: "datakvalitet"; anchor: string; label: string }
  | { section: "etikett"; anchor: string; label: string }
  | { section: "merker"; anchor: string; label: string };

export function fixTargetForChecklistKey(key: string, declarationManual: boolean): FixTarget | null {
  switch (key) {
    case "ingredients":
    case "allergens":
    case "may_contain":
      return declarationManual
        ? { section: "deklarasjon", anchor: "merking-editor", label: "Rett i deklarasjonen" }
        : { section: "datakvalitet", anchor: "merking-datakvalitet", label: "Rett i datakvalitet" };
    case "nutrition":
      return declarationManual
        ? { section: "deklarasjon", anchor: "merking-editor-naering", label: "Rett næringsinnhold" }
        : { section: "datakvalitet", anchor: "merking-datakvalitet", label: "Rett i datakvalitet" };
    case "net_weight":
      return { section: "etikett", anchor: "etikett-nettovekt", label: "Rett nettovekt" };
    case "shelf_life":
      return { section: "etikett", anchor: "etikett-holdbarhet", label: "Rett holdbarhet" };
    case "storage":
      return { section: "etikett", anchor: "etikett-oppbevaring", label: "Rett oppbevaring" };
    case "mark_grain":
      return { section: "merker", anchor: "merking-grovhet", label: "Rett grovhetsmerket" };
    case "mark_keyhole":
      return { section: "merker", anchor: "merking-nokkelhull", label: "Rett Nøkkelhullet" };
    default:
      return null;
  }
}

/**
 * Siste godkjenning = nyeste rad i deklarasjonsversjonene. Lagringsdatoen på
 * oppskriften (declaration_updated_at) settes også ved «Lagre kladd» og er
 * derfor aldri bevis på godkjenning.
 */
export function latestApprovalByRecipe(
  rows: Array<{ recipe_id: string; approved_at: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.approved_at) continue;
    const prev = out.get(r.recipe_id);
    if (!prev || new Date(r.approved_at).getTime() > new Date(prev).getTime()) out.set(r.recipe_id, r.approved_at);
  }
  return out;
}
