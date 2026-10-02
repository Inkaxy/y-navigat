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
