// Demo D – Ikke lest (D4). Ren logikk (testes): hvilke åpne fakturaer lesingen feilet på, og hvorfor i klartekst.
import { isAiFailureText } from "@/fakturaer/lib/aiFailure";

export interface UnreadInput {
  id: string; invoice_number: string | null; invoice_date: string | null; supplier_id: string | null;
  total_amount: number | null; line_extraction_status: string | null; line_extraction_error: string | null;
  lines_sum_status: string | null; tripletex_supplier_invoice_id: string | null;
}

export function isUnread(i: UnreadInput): boolean {
  return i.line_extraction_status === "failed" || !!(i.line_extraction_error ?? "").trim() || i.lines_sum_status === "mismatch";
}

/** Årsak i klartekst. Rå teknisk feiltekst vises aldri. */
export function unreadReason(i: UnreadInput): string {
  const e = (i.line_extraction_error ?? "").trim();
  if (e && isAiFailureText(e)) return "AI-tjenesten som leser fakturaene svarte ikke. Prøves igjen når tjenesten virker.";
  if (/side/i.test(e)) return "Lang samlefaktura. Ikke alle sider ble lest.";
  if (/ingen lesbare linjer/i.test(e)) return "PDF-en ga ingen lesbare linjer. Den kan være skannet eller uleselig.";
  if (i.line_extraction_status === "failed") return "Lesingen ga opp etter flere forsøk.";
  if (i.lines_sum_status === "mismatch") return "Summen av linjene stemmer ikke med fakturaen.";
  return "Fakturaen ble ikke lest ferdig.";
}

/** Kan legges tilbake i lesekøen (rm_requeue_invoice_line_extraction godtar bare Tripletex-fakturaer). */
export const canRequeue = (i: UnreadInput) => !!i.tripletex_supplier_invoice_id && (i.line_extraction_status === "done" || i.line_extraction_status === "failed");

export function sortUnread<T extends UnreadInput>(xs: readonly T[]): T[] {
  return [...xs].sort((a, b) => (a.invoice_date ?? "9999").localeCompare(b.invoice_date ?? "9999") || a.id.localeCompare(b.id));
}

const SKIP_TEXT: Record<string, string> = {
  finnes_ikke: "finnes ikke", ikke_tripletex: "ikke fra Tripletex", holdt_utenfor: "holdt utenfor", ikke_ferdig_lest: "leses allerede",
  leses_na: "leses nå",
};
export const requeueSkipText = (r: string) => SKIP_TEXT[r] ?? "låst eller allerede behandlet";
