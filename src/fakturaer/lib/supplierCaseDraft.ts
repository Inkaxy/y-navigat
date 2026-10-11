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
  amount_excl_vat: number;
}

export interface DraftInput {
  supplier_name: string | null;
  case_title: string;
  lines: readonly DraftLine[];
  credited: number;
}

export interface Draft { subject: string; body: string; missingBasis: boolean }

const nok = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("nb-NO", { maximumFractionDigits: 3 });
const date = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "ukjent dato");

export function buildSupplierCaseDraft(i: DraftInput): Draft {
  const krav = Math.round(i.lines.reduce((s, l) => s + l.amount_excl_vat, 0) * 100) / 100;
  const rest = Math.round((krav - i.credited) * 100) / 100;
  const missing = i.lines.filter((l) => l.expected == null);
  const numbers = [...new Set(i.lines.map((l) => l.invoice_number).filter((x): x is string => !!x))];
  const subject = `Prisavvik ${numbers.length ? `faktura ${numbers.join(", ")}` : i.case_title} – krav om kreditnota`;
  const rows = i.lines.map((l) => {
    const unit = l.unit ? `/${l.unit}` : "";
    const qty = l.quantity == null ? "mengde ukjent" : `${num(l.quantity)}${l.unit ? ` ${l.unit}` : ""}`;
    const exp = l.expected == null ? "forventet pris ikke dokumentert" : `forventet ${nok(l.expected)} kr${unit}`;
    const inv = l.invoiced == null ? "fakturert pris ukjent" : `fakturert ${nok(l.invoiced)} kr${unit}`;
    return `- Faktura ${l.invoice_number ?? "ukjent"} (${date(l.invoice_date)}): ${l.item}. ${qty}, ${exp}, ${inv}. Avvik ${nok(l.amount_excl_vat)} kr eks. mva.`;
  });
  const body = [
    `Hei ${i.supplier_name ?? ""}`.trim() + ",",
    "",
    "Vi har kontrollert fakturaene under mot dokumentert pris og finner avvik:",
    "",
    ...rows,
    "",
    `Samlet avvik: ${nok(krav)} kr eks. mva.`,
    ...(i.credited > 0 ? [`Allerede kreditert: ${nok(i.credited)} kr eks. mva.`, `Gjenstår: ${nok(rest)} kr eks. mva.`] : []),
    ...(missing.length ? ["", `Merk: For ${missing.length} ${missing.length === 1 ? "linje" : "linjer"} har vi ikke dokumentert avtalt pris. Vi ber om at dere bekrefter gjeldende pris for disse.`] : []),
    "",
    rest > 0 ? "Vi ber om en kreditnota for gjenstående beløp." : "Vi ber om en bekreftelse på prisen fremover.",
    "",
    "Med vennlig hilsen",
    "Nøtterø Bakeri",
  ].join("\n");
  return { subject, body, missingBasis: missing.length > 0 };
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
