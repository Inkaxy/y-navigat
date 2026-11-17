// Demo D – Ikke lest (D4). Ren logikk (testes): hvilke åpne fakturaer lesingen feilet på, og hvorfor i klartekst.
import { isAiFailureText } from "@/fakturaer/lib/aiFailure";
import { creditAlignedExpected, expectedExclVat } from "../../../../supabase/functions/_shared/lines-sum.ts";

export interface UnreadInput {
  id: string; invoice_number: string | null; invoice_date: string | null; supplier_id: string | null;
  total_amount: number | null; line_extraction_status: string | null; line_extraction_error: string | null;
  lines_sum_status: string | null; tripletex_supplier_invoice_id: string | null;
  /** Antall lagrede linjer (alle, som i sumkontrollen). Mangler = ukjent, behandles som uten linjer. */
  line_count?: number | null;
  lines_sum_excl_vat?: number | null; total_vat?: number | null; is_credit_note?: boolean | null;
  /** Rå revisjon (tekst fra serveren, aldri avrundet via Date). */
  updated_at?: string | null;
}

/**
 * To grupper: «Ikke lest» (ingen linjer – kan legges i lesekøen) og «Lest, men summen stemmer ikke» (har linjer –
 * lesekøen tar bare fakturaer uten linjer, så disse må leses på nytt med forslag eller godtas).
 */
export type UnreadGroup = "uten_linjer" | "har_linjer";
export const unreadGroup = (i: UnreadInput): UnreadGroup => ((i.line_count ?? 0) > 0 ? "har_linjer" : "uten_linjer");

/**
 * Linjesum minus fakturasum eks. mva, i kroner (samme regel som sumkontrollen, også for kreditnota).
 * Null når mva eller linjesum mangler – da kan differansen ikke regnes i kroner.
 */
export function sumDifference(i: UnreadInput): number | null {
  const lines = i.lines_sum_excl_vat == null ? null : Number(i.lines_sum_excl_vat);
  const total = i.total_amount == null ? null : Number(i.total_amount);
  const vat = i.total_vat == null ? null : Number(i.total_vat);
  if (lines == null || !Number.isFinite(lines)) return null;
  const isCredit = i.is_credit_note === true;
  const exp = expectedExclVat(total, vat, isCredit);
  if (exp == null) return null;
  return Number((lines - creditAlignedExpected(exp, lines, isCredit)).toFixed(2));
}

/** Differansen i klartekst med norske tall. */
export function sumDifferenceText(d: number | null): string {
  if (d == null) return "Differansen kan ikke regnes i kroner (mva mangler på fakturaen).";
  const kr = Math.abs(d).toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (d === 0) return "Linjene og fakturaen er like i kroner, men avviket er over grensen i prosent.";
  return d < 0 ? `Linjene er ${kr} kr lavere enn fakturaen (eks. mva).` : `Linjene er ${kr} kr høyere enn fakturaen (eks. mva).`;
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
  finnes_ikke: "finnes ikke lenger", ikke_tripletex: "er ikke fra Tripletex", holdt_utenfor: "er holdt utenfor",
  ikke_ferdig_lest: "står allerede i lesekøen", leses_na: "leses nå", har_linjer: "har allerede linjer",
  har_rettelser: "har rettede linjer", kostpris_fort: "har ført kostpris", godkjent: "er godkjent", avstemt: "er avstemt",
};
export const requeueSkipText = (r: string) => SKIP_TEXT[r] ?? "ble avvist av serveren av en annen grunn";

/**
 * Meldingen etter «Les alle på nytt»: hva som faktisk skjedde og hvorfor noe ble hoppet over.
 * `withLines` = fakturaer med linjer som ikke sendes til lesekøen (de vises i gruppen under).
 */
export function requeueMessage(o: { requeued: number; skipped: readonly { reason: string }[]; withLines: number }): string {
  const n = (x: number) => x.toLocaleString("nb-NO");
  const parts = [`${n(o.requeued)} lagt i lesekøen.`];
  const lines = o.withLines + o.skipped.filter((s) => s.reason === "har_linjer").length;
  if (lines > 0) parts.push(`${n(lines)} har allerede linjer og må leses på nytt med forslag – se under.`);
  const other = new Map<string, number>();
  for (const s of o.skipped) if (s.reason !== "har_linjer") { const t = requeueSkipText(s.reason); other.set(t, (other.get(t) ?? 0) + 1); }
  const total = [...other.values()].reduce((a, b) => a + b, 0);
  if (total > 0) parts.push(`${n(total)} ble hoppet over: ${[...other].map(([t, c]) => `${n(c)} ${t}`).join(", ")}.`);
  return parts.join(" ");
}
