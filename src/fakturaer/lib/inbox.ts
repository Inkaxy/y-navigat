/**
 * Hva trenger fakturaen at noen gjør? Rene hjelpere for fakturakortene
 * øverst i innboksen — uten React og Supabase slik at de kan testes.
 */

export type InboxIssue =
  | "missing_lines"
  | "unmatched_lines"
  | "price_variance"
  | "sum_mismatch"
  | "credit_note_unlinked";

export const INBOX_ISSUE_LABELS: Record<InboxIssue, string> = {
  missing_lines: "Mangler linjer",
  unmatched_lines: "Umatchede linjer",
  price_variance: "Prisavvik",
  sum_mismatch: "Sumavvik",
  credit_note_unlinked: "Kreditnota uten kobling",
};

export interface InboxLine {
  raw_material_id: string | null;
  requires_review: boolean | null;
  price_variance_pct: number | null;
  variance_status: string | null;
  category: string | null;
}

export interface InboxInvoiceInput {
  status: string;
  is_credit_note: boolean | null;
  lines_sum_status: string | null;
  /** Fritekst på fakturaen — koblingen til opprinnelig faktura lagres her. */
  notes?: string | null;
  lines: InboxLine[];
}

/** Slik skrives koblingen fra en kreditnota til den opprinnelige fakturaen. */
export const CREDIT_NOTE_REF_PREFIX = "Opprinnelig faktura:";

/**
 * Fakturanummeret kreditnotaen er knyttet til, eller null når koblingen mangler.
 * Databasen har ingen egen kolonne for dette, så referansen leses fra notatet.
 */
export function creditNoteOriginalRef(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const m = new RegExp(`${CREDIT_NOTE_REF_PREFIX}\\s*(\\S+)`, "i").exec(notes);
  return m ? m[1] : null;
}

export interface InboxAssessment {
  issues: InboxIssue[];
  unmatchedCount: number;
  reviewCount: number;
  varianceCount: number;
  /** Fakturaen kan avstemmes når ingenting krever handling. */
  canReconcile: boolean;
  /** Forklaringen som vises i tooltip når avstemming er sperret. */
  reconcileBlockedReason: string | null;
}

export function assessInboxInvoice(
  inv: InboxInvoiceInput,
  toleranceFor: (category?: string | null) => number,
): InboxAssessment {
  const lines = inv.lines ?? [];
  const issues: InboxIssue[] = [];

  const unmatched = lines.filter((l) => !l.raw_material_id);
  const reviewCount = lines.filter((l) => l.requires_review).length;
  const varianceLines = lines.filter((l) => {
    const v = l.price_variance_pct;
    if (v == null || !Number.isFinite(Number(v))) return false;
    return Math.abs(Number(v)) > toleranceFor(l.category);
  });

  if (lines.length === 0) issues.push("missing_lines");
  if (unmatched.length > 0) issues.push("unmatched_lines");
  if (varianceLines.length > 0) issues.push("price_variance");
  if (inv.lines_sum_status === "mismatch") issues.push("sum_mismatch");
  // Kreditnotaen mangler kobling når notatet ikke peker på en opprinnelig faktura.
  if (inv.is_credit_note && !creditNoteOriginalRef(inv.notes)) issues.push("credit_note_unlinked");

  const blockers: string[] = [];
  if (lines.length === 0) blockers.push("fakturaen mangler linjer");
  if (reviewCount > 0) blockers.push(`${reviewCount} linje(r) krever gjennomgang`);
  if (unmatched.length > 0) blockers.push(`${unmatched.length} linje(r) er ikke matchet`);
  if (inv.lines_sum_status === "mismatch") blockers.push("linjene summerer seg ikke til fakturabeløpet");
  if (inv.is_credit_note && !creditNoteOriginalRef(inv.notes))
    blockers.push("kreditnotaen er ikke knyttet til en opprinnelig faktura");

  return {
    issues,
    unmatchedCount: unmatched.length,
    reviewCount,
    varianceCount: varianceLines.length,
    canReconcile: blockers.length === 0 && inv.status !== "reconciled" && inv.status !== "flagged",
    reconcileBlockedReason:
      inv.status === "flagged"
        ? "Fakturaen er flagget. Fjern flagget først."
        : inv.status === "reconciled"
          ? "Fakturaen er allerede avstemt."
          : blockers.length > 0
            ? `Kan ikke avstemmes: ${blockers.join(", ")}.`
            : null,
  };
}

/** Sorterer fakturaer med flest åpne punkter først. */
export function issueWeight(issues: InboxIssue[]): number {
  return issues.length;
}
