/**
 * Hva trenger fakturaen at noen gjør? Rene hjelpere for fakturainnboksen —
 * uten React og Supabase slik at de kan testes.
 *
 * Vurderingen bygger på det matchemotoren har lagret (review_reason,
 * requires_review, match_confidence). Den regner ikke egne prosentgrenser:
 * et prisavvik som er godtatt på serveren er ikke lenger et avvik her.
 */

import { CREDIT_NOTE_REF_PREFIX, creditNoteOriginalRef } from "@/fakturaer/lib/creditNote";
export { CREDIT_NOTE_REF_PREFIX, creditNoteOriginalRef };

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
  match_confidence?: string | null;
  review_reason?: string | null;
}

export interface InboxInvoiceInput {
  status: string;
  is_credit_note: boolean | null;
  lines_sum_status: string | null;
  /** Fritekst på fakturaen — koblingen til opprinnelig faktura lagres her. */
  notes?: string | null;
  line_extraction_status?: string | null;
  lines: InboxLine[];
}

export interface InboxAssessment {
  issues: InboxIssue[];
  unmatchedCount: number;
  reviewCount: number;
  varianceCount: number;
  /** Antall linjer som fortsatt krever handling. */
  openCount: number;
  /** Antall linjer som er avklart (koblet uten åpne punkter, eller ikke råvare). */
  doneCount: number;
  /** Fakturaen kan avstemmes når ingenting krever handling. */
  canReconcile: boolean;
  /** Forklaringen som vises når avstemming er sperret. */
  reconcileBlockedReason: string | null;
}

const PRICE_REASONS = new Set(["price_variance", "price_increase", "price_drop"]);

const reasonsOf = (l: InboxLine) =>
  String(l.review_reason ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

const isNotApplicable = (l: InboxLine) => l.match_confidence === "not_applicable";

/** Linjen står åpen når serveren sier den krever gjennomgang, eller den mangler kobling. */
export function lineIsOpen(l: InboxLine): boolean {
  if (isNotApplicable(l)) return false;
  return !l.raw_material_id || !!l.requires_review || reasonsOf(l).length > 0;
}

export function assessInboxInvoice(
  inv: InboxInvoiceInput,
  /** Beholdt for bakoverkompatibilitet — avvik avgjøres av serverens årsaker. */
  _toleranceFor?: (category?: string | null) => number,
): InboxAssessment {
  const lines = inv.lines ?? [];
  const issues: InboxIssue[] = [];

  const unmatched = lines.filter((l) => !isNotApplicable(l) && !l.raw_material_id);
  const reviewCount = lines.filter((l) => !isNotApplicable(l) && l.requires_review).length;
  const varianceLines = lines.filter(
    (l) => !isNotApplicable(l) && !!l.requires_review && reasonsOf(l).some((r) => PRICE_REASONS.has(r)),
  );
  const openCount = lines.filter(lineIsOpen).length;
  const extractionPending = ["pending", "failed", "processing"].includes(inv.line_extraction_status ?? "");

  if (lines.length === 0 || extractionPending) issues.push("missing_lines");
  if (unmatched.length > 0) issues.push("unmatched_lines");
  if (varianceLines.length > 0) issues.push("price_variance");
  if (inv.lines_sum_status === "mismatch") issues.push("sum_mismatch");
  if (inv.is_credit_note && !creditNoteOriginalRef(inv.notes)) issues.push("credit_note_unlinked");

  const blockers: string[] = [];
  if (lines.length === 0) blockers.push("fakturaen mangler linjer");
  else if (extractionPending) blockers.push("linjene er ikke ferdig hentet");
  if (openCount > 0) blockers.push(`${openCount} linje(r) må avklares`);
  if (inv.lines_sum_status === "mismatch") blockers.push("linjene summerer seg ikke til fakturabeløpet");
  if (inv.lines_sum_status == null && lines.length > 0) blockers.push("linjesummen er ikke kontrollert");
  if (inv.is_credit_note && !creditNoteOriginalRef(inv.notes))
    blockers.push("kreditnotaen er ikke knyttet til en opprinnelig faktura");

  const locked = inv.status === "reconciled" || inv.status === "flagged" || inv.status === "cancelled";
  return {
    issues,
    unmatchedCount: unmatched.length,
    reviewCount,
    varianceCount: varianceLines.length,
    openCount,
    doneCount: lines.length - openCount,
    canReconcile: blockers.length === 0 && !locked,
    reconcileBlockedReason:
      inv.status === "flagged"
        ? "Fakturaen er flagget. Fjern flagget først."
        : inv.status === "reconciled"
          ? "Fakturaen er allerede fullført."
          : blockers.length > 0
            ? `Kan ikke fullføres: ${blockers.join(", ")}.`
            : null,
  };
}

/** Sorterer fakturaer med flest åpne punkter først. */
export function issueWeight(issues: InboxIssue[]): number {
  return issues.length;
}

export type InboxTab = "open" | "ready" | "done";

/** Fanen fakturaen hører til. «Klar» følger linjene, ikke bare lagret status. */
export function inboxTabOf(inv: { status: string; assessment: InboxAssessment }): InboxTab {
  if (inv.status === "reconciled") return "done";
  return inv.assessment.canReconcile ? "ready" : "open";
}

export type InboxPrimaryAction = "fetch_lines" | "register_lines" | "link_credit_note" | "unflag" | "resolve" | "finish";

/** ÉN meningsfull handling per rad, og en kort forklaring. */
export function inboxPrimaryAction(inv: {
  status: string;
  source: string | null;
  line_count: number;
  line_extraction_status: string | null;
  assessment: InboxAssessment;
}): { action: InboxPrimaryAction; label: string; hint: string } {
  const a = inv.assessment;
  if (inv.status === "flagged") return { action: "unflag", label: "Se flagget", hint: "Fakturaen er flagget" };
  const missing = inv.line_count === 0 || ["pending", "failed"].includes(inv.line_extraction_status ?? "");
  if (missing) {
    return inv.source === "tripletex"
      ? { action: "fetch_lines", label: "Hent linjer", hint: "Linjene er ikke hentet ennå" }
      : { action: "register_lines", label: "Registrer linjer", hint: "Linjene må registreres" };
  }
  if (a.issues.includes("credit_note_unlinked") && a.openCount === 0)
    return { action: "link_credit_note", label: "Koble kreditnota", hint: "Mangler opprinnelig faktura" };
  if (a.canReconcile) return { action: "finish", label: "Fullfør kontroll", hint: "Alle linjer er avklart" };
  const n = a.openCount;
  const hint =
    a.issues.includes("sum_mismatch") && n === 0
      ? "Linjene stemmer ikke med fakturabeløpet"
      : a.unmatchedCount > 0
        ? `${a.unmatchedCount} uten råvare`
        : a.varianceCount > 0
          ? `${a.varianceCount} med prisavvik`
          : n > 0
            ? `${n} må kontrolleres`
            : a.reconcileBlockedReason ?? "Må kontrolleres";
  return { action: "resolve", label: n > 0 ? `Avklar ${n} ${n === 1 ? "punkt" : "punkter"}` : "Åpne", hint };
}
