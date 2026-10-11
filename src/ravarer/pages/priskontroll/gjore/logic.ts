/**
 * Ren logikk for Priskontroll › Å gjøre: valgt-nøkkel, «Neste», primærhandling
 * i Pris-blokken og norske tekster for alle feilkoder fra serveren.
 */
import type { AcceptSkipReason, WorkGroup, WorkItem, WorkSort } from "@/ravarer/lib/workRpcTypes";
import { WORK_GROUPS } from "@/ravarer/lib/workRpcTypes";

// ---------- valgt-nøkkel ----------
export type Valgt =
  | { type: "varekort"; supplierId: string; itemKey: string }
  | { type: "faktura"; invoiceId: string };

/** `varekort:{supplier_id}:{item_key}` (item_key kan selv inneholde «:») eller `faktura:{invoice_id}`. */
export function parseValgt(v: string | null | undefined): Valgt | null {
  if (!v) return null;
  if (v.startsWith("faktura:")) {
    const id = v.slice("faktura:".length);
    return id ? { type: "faktura", invoiceId: id } : null;
  }
  if (v.startsWith("varekort:")) {
    const rest = v.slice("varekort:".length);
    const i = rest.indexOf(":");
    if (i <= 0) return null;
    const supplierId = rest.slice(0, i);
    const itemKey = rest.slice(i + 1);
    return itemKey ? { type: "varekort", supplierId, itemKey } : null;
  }
  return null;
}

export const varekortKey = (supplierId: string, itemKey: string) => `varekort:${supplierId}:${itemKey}`;
export const fakturaKey = (invoiceId: string) => `faktura:${invoiceId}`;

// ---------- URL-parametre ----------
export const GJORE_SORTS: { id: WorkSort; label: string }[] = [
  { id: "impact", label: "Størst kronevirkning" },
  { id: "frequency", label: "Går oftest igjen" },
  { id: "newest", label: "Nyeste" },
];

export function parseGruppe(v: string | null): WorkGroup {
  return (WORK_GROUPS as readonly string[]).includes(v ?? "") ? (v as WorkGroup) : "alle";
}
export function parseSort(v: string | null): WorkSort {
  return v === "frequency" || v === "newest" ? v : "impact";
}

export const GROUP_LABELS: Record<WorkGroup, string> = {
  alle: "Alle",
  kobling: "Mangler kobling",
  pakning: "Mangler pakning",
  pris: "Prisendringer",
  kontroll: "Kontroll",
  fakturaer: "Fakturaer",
};

// ---------- Neste ----------
/** Neste element i samme sortering etter at `key` er ferdig; forrige hvis det var sist. */
export function pickNext(items: Pick<WorkItem, "key">[], key: string | null): string | null {
  const rest = items.filter((i) => i.key !== key);
  if (!key) return rest[0]?.key ?? null;
  const idx = items.findIndex((i) => i.key === key);
  if (idx < 0) return rest[0]?.key ?? null;
  return items[idx + 1]?.key ?? items[idx - 1]?.key ?? null;
}

/** Flytt markøren (J/K). */
export function stepKey(items: Pick<WorkItem, "key">[], key: string | null, dir: 1 | -1): string | null {
  if (items.length === 0) return null;
  const idx = key ? items.findIndex((i) => i.key === key) : -1;
  if (idx < 0) return items[dir === 1 ? 0 : items.length - 1].key;
  const n = Math.min(items.length - 1, Math.max(0, idx + dir));
  return items[n].key;
}

// ---------- Pris-blokken ----------
export type PriceLine = { id: string; price_per_base_unit: number; expected_price_per_base_unit: number; base_quantity: number | null };

export type PriceChange = { expected: number; actual: number; pct: number; impactNok: number };

/** Mengdevektet sammenligning for valgte linjer. Null når grunnlag mangler. */
export function priceChange(lines: PriceLine[]): PriceChange | null {
  const usable = lines.filter((l) => l.expected_price_per_base_unit > 0);
  if (usable.length === 0) return null;
  const w = (l: PriceLine) => (l.base_quantity != null && l.base_quantity > 0 ? l.base_quantity : 1);
  const tw = usable.reduce((s, l) => s + w(l), 0);
  const expected = usable.reduce((s, l) => s + l.expected_price_per_base_unit * w(l), 0) / tw;
  const actual = usable.reduce((s, l) => s + l.price_per_base_unit * w(l), 0) / tw;
  const impactNok = usable.reduce((s, l) => s + (l.price_per_base_unit - l.expected_price_per_base_unit) * (l.base_quantity ?? 0), 0);
  return { expected, actual, pct: ((actual - expected) / expected) * 100, impactNok };
}

/** Merkostnaden et kreditkrav gjelder: bare linjer som er dyrere enn forventet. */
export function claimAmount(lines: PriceLine[]): number {
  return lines.reduce((s, l) => {
    const d = l.price_per_base_unit - l.expected_price_per_base_unit;
    return d > 0 && l.base_quantity ? s + d * l.base_quantity : s;
  }, 0);
}

export type PricePrimary = "accept" | "claim";

/**
 * «Godta ny pris» er primær når prisen gikk ned eller endringen er innenfor
 * maksgrensen. «Krev kreditt» er primær når prisen gikk OPP over maksgrensen
 * og det finnes en avtalepris å holde leverandøren til.
 */
export function pricePrimaryAction(a: { pct: number | null; hardCapPct: number; hasAgreement: boolean }): PricePrimary {
  if (a.pct == null || a.pct <= 0) return "accept";
  return a.pct > a.hardCapPct && a.hasAgreement ? "claim" : "accept";
}

/** Store prisavvik skyldes ofte feil pakning. */
export const PACKAGE_HINT_PCT = 40;
export const showPackageHint = (pct: number | null) => pct != null && Math.abs(pct) > PACKAGE_HINT_PCT;

// ---------- norske tekster ----------
export const SKIP_REASON_LABEL: Record<AcceptSkipReason, string> = {
  andre_arsaker: "Linjen har andre åpne spørsmål enn prisen",
  endret: "Linjen er endret siden du så den — last inn på nytt",
  faktura_last: "Fakturaen er låst (avstemt eller flagget)",
  ikke_koblet: "Linjen er ikke koblet til en råvare",
  mangler_prisgrunnlag: "Linjen mangler prisgrunnlag",
  feil: "Linjen kunne ikke godtas",
};

/** Norsk etikett for en overhoppet linje. Ved «feil» kan serverens melding være en kode — bruk vår etikett. */
function skipWhy(l: { reason: AcceptSkipReason; message: string }): string {
  return l.reason === "feil" ? SKIP_REASON_LABEL.feil : l.message.trim() || SKIP_REASON_LABEL[l.reason];
}

export function skipLineText(l: { invoice_number: string | null; reason: AcceptSkipReason; message: string }): string {
  const why = skipWhy(l);
  return l.invoice_number ? `Faktura ${l.invoice_number}: ${why}` : why;
}

export const CHANGE_LINK_ERRORS: Record<string, string> = {
  begrunnelse_mangler: "Skriv en begrunnelse",
  kobling_finnes_ikke: "Koblingen finnes ikke lenger",
  ugyldig_raavare: "Velg en aktiv råvare i samme selskap",
  samme_raavare: "Det er allerede denne råvaren",
  kobling_finnes: "Leverandøren er allerede koblet til den råvaren — bruk den koblingen",
  kobling_uten_varenummer: "Koblingen har ikke varenummer — bruk Koble på nytt i varekortet",
  varenummer_stemmer_ikke: "Linjene har et annet varenummer enn koblingen — bruk Koble på nytt i varekortet",
  forbidden: "Du mangler skrivetilgang",
};

/** Feil fra `rm_supplier_item_claim_credit` / `create_supplier_deviation_case` → norsk. */
export const CLAIM_ERRORS: [RegExp, string][] = [
  [/skrivetilgang|forbidden/i, "Du mangler skrivetilgang"],
  [/linje_allerede_i_aapen_sak/, "En av linjene er allerede med i en åpen leverandørsak"],
  [/prisgrunnlag_mangler/, "En av linjene mangler prisgrunnlag eller mengde — kravet kan ikke beregnes"],
  [/ingen_merkostnad/, "Ingen av linjene er dyrere enn forventet — ingenting å kreve"],
  [/Saken må ha en tittel|tittel_mangler/, "Saken må ha en tittel"],
  [/Velg linjene kravet gjelder|ingen_linjer/, "Velg linjene kravet gjelder"],
  [/linjene_maa_ha_samme_selskap_og_leverandor/, "Linjene må være fra samme leverandør"],
];
export function claimErrorMessage(raw: string | null | undefined): string {
  const hit = CLAIM_ERRORS.find(([re]) => re.test(raw ?? ""));
  return hit ? hit[1] : "Kravet kunne ikke opprettes. Prøv igjen.";
}

/** Exception-meldingen fra `rm_change_supplier_link` → norsk. Lengste kode først (kobling_finnes_ikke før kobling_finnes). */
export function changeLinkErrorMessage(raw: string | null | undefined): string {
  const msg = raw ?? "";
  const hit = Object.keys(CHANGE_LINK_ERRORS).sort((a, b) => b.length - a.length).find((k) => msg.includes(k));
  return hit ? CHANGE_LINK_ERRORS[hit] : "Koblingen kunne ikke endres. Prøv igjen.";
}

export function lockedLinesText(n: number): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? "linje er" : "linjer er"} låst fordi kostpris er ført — de beholder gammel kobling`;
}

export type ClaimFailure = "ingen_merkostnad" | "ingen_godtatt";
export function claimFailureMessage(reason: ClaimFailure, skipped: { invoice_number: string | null; reason: AcceptSkipReason; message: string }[] = []): string {
  if (reason === "ingen_merkostnad") return "Ingen av linjene er dyrere enn forventet — ingenting å kreve";
  const grunner = [...new Set(skipped.map(skipWhy))];
  return `Ingen linjer kunne godtas: ${grunner.length ? grunner.join("; ") : "ukjent årsak"}`;
}

export function acceptResultTitle(accepted: number, invoices: number): string {
  return `${accepted} ${accepted === 1 ? "linje" : "linjer"} godtatt · ${invoices} ${invoices === 1 ? "faktura regnes" : "fakturaer regnes"} om`;
}

/** «Forsøk n/3» — aldri over 3. */
export const attemptsText = (n: number | null | undefined) => `Forsøk ${Math.min(3, Math.max(0, n ?? 0))}/3.`;

export const kr = (n: number) => `${n.toLocaleString("nb-NO", { maximumFractionDigits: 0 })} kr`;
export const signedKr = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${kr(Math.abs(n))}`;
export const signedPct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} %`;
export const ppbu = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
