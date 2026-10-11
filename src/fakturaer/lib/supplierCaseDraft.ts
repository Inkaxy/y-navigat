/**
 * Norsk e-postkladd for en leverandørsak. Ren funksjon (testes). Teksten er
 * ren tekst — serveren HTML-escaper alle felt når e-posten bygges.
 */
export interface DraftLine {
  invoice_number: string | null;
  invoice_date: string | null;
  item: string;
  quantity: number | null;
  unit: string | null;
  expected: number | null;
  invoiced: number | null;
  /** Kravbeløp fra serverens låste grunnlag (0 for prisforespørsel). */
  amount_excl_vat: number;
  /** Observert prisforskjell (bare informasjon ved prisforespørsel). */
  observed_excl_vat?: number | null;
  reference_source?: string | null;
  reference_date?: string | null;
}

/** Sakstype fra saklinjenes låste grunnlag; `null` = eldre/blandet sak uten kontrollert grunnlag. */
export type DraftKind = "documented_claim" | "price_inquiry" | null;

export interface DraftInput {
  supplier_name: string | null;
  case_title: string;
  kind: DraftKind;
  lines: readonly DraftLine[];
  credited: number;
}

export interface Draft { subject: string; body: string; missingBasis: boolean; blocked: boolean }

const nok = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 3 });
const date = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "ukjent dato");
const REF: Record<string, string> = { agreement: "avtalt pris", last_purchase: "pris ved tidligere kjøp", start_price: "bekreftet startpris" };

/** Saktype for en sak: alle linjer må ha samme kontrollerte type, ellers null (lukket). */
export function caseKindOf(kinds: readonly (string | null | undefined)[]): DraftKind {
  if (kinds.length === 0) return null;
  const k = kinds[0];
  if ((k !== "documented_claim" && k !== "price_inquiry") || kinds.some((x) => x !== k)) return null;
  return k;
}

export function buildSupplierCaseDraft(i: DraftInput): Draft {
  const numbers = [...new Set(i.lines.map((l) => l.invoice_number).filter((x): x is string => !!x))];
  const ref = numbers.length ? `faktura ${numbers.join(", ")}` : i.case_title;
  if (i.kind == null) {
    // Eldre sak uten låst, kontrollert grunnlag: ingen kladd som påstår krav eller pris.
    return { subject: `Prisspørsmål ${ref}`, body: "", missingBasis: true, blocked: true };
  }
  const head = (l: DraftLine) => {
    const unit = l.unit ? `/${l.unit}` : "";
    const qty = l.quantity == null ? "mengde ukjent" : `${num(l.quantity)}${l.unit ? ` ${l.unit}` : ""}`;
    const refTxt = REF[l.reference_source ?? ""] ?? "sammenligningspris";
    const exp = l.expected == null ? `${refTxt} ikke dokumentert` : `${refTxt} ${nok(l.expected)} kr${unit}${l.reference_date ? ` (${date(l.reference_date)})` : ""}`;
    const inv = l.invoiced == null ? "fakturert pris ukjent" : `fakturert ${nok(l.invoiced)} kr${unit}`;
    return `- Faktura ${l.invoice_number ?? "ukjent"} (${date(l.invoice_date)}): ${l.item}. ${qty}, ${exp}, ${inv}.`;
  };
  const hello = `Hei ${i.supplier_name ?? ""}`.trim() + ",";
  const sign = ["", "Med vennlig hilsen", "Nøtterø Bakeri"];

  if (i.kind === "price_inquiry") {
    const obs = i.lines.every((l) => l.observed_excl_vat != null) ? Math.round(i.lines.reduce((s, l) => s + (l.observed_excl_vat ?? 0), 0) * 100) / 100 : null;
    const body = [
      hello, "",
      "Vi ser at prisen på fakturaene under er annerledes enn det vi har betalt tidligere:", "",
      ...i.lines.map(head), "",
      ...(obs != null ? [`Observert prisforskjell: ${nok(obs)} kr eks. mva. Dette er ikke et krav.`, ""] : []),
      "Kan dere bekrefte gjeldende pris og årsaken til endringen?",
      ...sign,
    ].join("\n");
    return { subject: `Spørsmål om pris – ${ref}`, body, missingBasis: false, blocked: false };
  }

  const krav = Math.round(i.lines.reduce((s, l) => s + l.amount_excl_vat, 0) * 100) / 100;
  const rest = Math.round((krav - i.credited) * 100) / 100;
  const missing = i.lines.filter((l) => l.expected == null);
  const body = [
    hello, "",
    "Vi har kontrollert fakturaene under mot avtalt pris og finner avvik:", "",
    ...i.lines.map((l) => `${head(l)} Avvik ${nok(l.amount_excl_vat)} kr eks. mva.`), "",
    `Samlet avvik: ${nok(krav)} kr eks. mva.`,
    ...(i.credited > 0 ? [`Allerede kreditert: ${nok(i.credited)} kr eks. mva.`, `Gjenstår: ${nok(rest)} kr eks. mva.`] : []),
    ...(missing.length ? ["", `Merk: For ${missing.length} ${missing.length === 1 ? "linje" : "linjer"} har vi ikke dokumentert avtalt pris. Vi ber om at dere bekrefter gjeldende pris for disse.`] : []),
    "",
    rest > 0 ? "Vi ber om en kreditnota for gjenstående beløp." : "Vi ber om en bekreftelse på prisen fremover.",
    ...sign,
  ].join("\n");
  return { subject: `Prisavvik ${ref} – krav om kreditnota`, body, missingBasis: missing.length > 0, blocked: false };
}

export type OutboxState = "ikke_sendt" | "i_ko" | "sendt" | "feilet";

export function outboxState(status: string | null | undefined): OutboxState {
  if (status === "sent") return "sendt";
  if (status === "failed") return "feilet";
  if (status === "pending" || status === "sending") return "i_ko";
  return "ikke_sendt";
}

export const OUTBOX_LABEL: Record<OutboxState, string> = {
  ikke_sendt: "Ikke sendt",
  i_ko: "I kø til Henrik",
  sendt: "Sendt til Henrik",
  feilet: "Utsending feilet",
};
