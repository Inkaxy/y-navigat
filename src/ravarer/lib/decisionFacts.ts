/**
 * Variant B – fakta til et prisspørsmål (ren logikk): kjøp i datorekkefølge, regnestykket for linjen
 * som avgjøres nå, endring mot forrige godkjente kjøp, hvor sikkert forslaget er og merkostnad per måned.
 * Bare lesing av rm_supplier_item_lines; ingen beregning skrives.
 */
import type { SupplierItemLine } from "@/fakturaer/lib/supplierItems";
import { SUSPICIOUS_JUMP_PCT, kr, dateNo, type DecisionType } from "./decisions";

export type PurchaseStatus = "godkjent" | "na" | "apen" | "ukjent";
export interface Purchase {
  lineId: string; invoiceId: string; invoiceNumber: string | null; date: string;
  price: number; changePct: number | null; status: PurchaseStatus;
}

export type Certainty = "sikkert" | "middels" | "usikkert";
export interface PriceFacts {
  purchases: Purchase[];
  current: SupplierItemLine | null;
  previous: Purchase | null;
  changePct: number | null;
  certainty: Certainty;
  certaintyText: string;
  arithmetic: string[];
  /** (ny − forrige pris) × gjennomsnittlig mengde per måned siste 90 dager. Null = ukjent. */
  monthlyExtraNok: number | null;
  /** Merkostnad på fakturaene som besvares (ny − forrige) × mengde på åpne linjer. */
  openExtraNok: number | null;
  baseUnit: string | null;
  suspicious: boolean;
}

const isOpen = (l: SupplierItemLine) => l.requires_review === true && l.invoice_status !== "reconciled" && !l.flagged_at;
const hasIssues = (l: SupplierItemLine) => Array.isArray(l.extraction_issues) && l.extraction_issues.length > 0;
const round2 = (n: number) => Math.round(n * 100) / 100;
const nb = (n: number, d = 3) => n.toLocaleString("nb-NO", { maximumFractionDigits: d });

function cmp(a: SupplierItemLine, b: SupplierItemLine) {
  const da = a.invoice_date ?? "", db = b.invoice_date ?? "";
  if (da !== db) return da < db ? -1 : 1;
  const ca = a.created_at ?? "", cb = b.created_at ?? "";
  return ca < cb ? -1 : ca > cb ? 1 : a.id < b.id ? -1 : 1;
}

/** Grunnenhet: pakningens enhet når den er en mål-enhet, ellers ukjent. */
export function baseUnitOf(l: SupplierItemLine | null): string | null {
  const u = (l?.package_unit ?? "").toLowerCase();
  return ["kg", "g", "l", "ml", "stk"].includes(u) ? (u === "g" ? "kg" : u === "ml" ? "l" : u) : null;
}

export function arithmeticFor(l: SupplierItemLine | null, baseUnit: string | null): string[] {
  if (!l || l.base_quantity == null || l.price_per_base_unit == null) return [];
  const bu = baseUnit ?? "enhet";
  const out: string[] = [];
  if (l.quantity != null && l.package_size != null) {
    const unit = l.unit ? ` ${l.unit}` : "";
    out.push(`${nb(l.quantity)}${unit} × ${nb(l.package_size)} ${l.package_unit ?? ""}`.trimEnd() + ` = ${nb(l.base_quantity)} ${bu}`);
  }
  if (l.total_amount != null) out.push(`${kr(l.total_amount)} / ${nb(l.base_quantity)} ${bu} = ${kr(l.price_per_base_unit)}/${bu}`);
  return out;
}

export function priceFacts(lines: readonly SupplierItemLine[], todayIso: string, maxShown = 8): PriceFacts {
  const priced = lines.filter((l) => l.price_per_base_unit != null && l.invoice_date && l.is_credit_note !== true).sort(cmp);
  const current = priced.find(isOpen) ?? null;
  const purchases: Purchase[] = [];
  let prev: number | null = null;
  for (const l of priced) {
    const price = l.price_per_base_unit as number;
    const status: PurchaseStatus = l === current ? "na" : isOpen(l) ? "apen" : l.in_price_history === true ? "godkjent" : "ukjent";
    purchases.push({
      lineId: l.id, invoiceId: l.invoice_id, invoiceNumber: l.invoice_number, date: l.invoice_date as string, price,
      changePct: prev != null && prev !== 0 ? round2((price / prev - 1) * 100) : null, status,
    });
    prev = price;
  }
  const curIdx = current ? purchases.findIndex((p) => p.lineId === current.id) : -1;
  const previous = curIdx > 0 ? [...purchases.slice(0, curIdx)].reverse().find((p) => p.status === "godkjent") ?? purchases[curIdx - 1] : null;
  const changePct = current && previous && previous.price !== 0 ? round2(((current.price_per_base_unit as number) / previous.price - 1) * 100) : null;
  const baseUnit = baseUnitOf(current);

  // Sikkerhet: bekreftet pris lest likt på flere åpne fakturaer uten lesevarsler = sikkert.
  let certainty: Certainty = "middels";
  let certaintyText = "Prisen er lest på én faktura";
  if (current) {
    const same = priced.filter((l) => isOpen(l) && Math.abs((l.price_per_base_unit as number) - (current.price_per_base_unit as number)) < 0.005);
    const invoices = new Set(same.map((l) => l.invoice_id)).size;
    if (priced.some((l) => isOpen(l) && hasIssues(l))) { certainty = "usikkert"; certaintyText = "Minst én linje har lesevarsel – kontroller originalen"; }
    else if (current.package_size == null) { certainty = "usikkert"; certaintyText = "Pakningen er ikke kjent"; }
    else if (invoices >= 2) { certainty = "sikkert"; certaintyText = `Pakningen er kjent, og prisen er lest likt på ${invoices} fakturaer`; }
    else certaintyText = "Pakningen er kjent, men prisen er lest på én faktura";
  }

  // Merkostnad per måned ved dagens forbruk (siste 90 dager).
  let monthlyExtraNok: number | null = null;
  let openExtraNok: number | null = null;
  if (current && previous) {
    const diff = (current.price_per_base_unit as number) - previous.price;
    const from = new Date(`${todayIso}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 90);
    const fromIso = from.toISOString().slice(0, 10);
    const recent = priced.filter((l) => (l.invoice_date as string) >= fromIso && l.base_quantity != null);
    if (recent.length) monthlyExtraNok = Math.round((diff * recent.reduce((s, l) => s + (l.base_quantity as number), 0)) / 3);
    const open = priced.filter((l) => isOpen(l) && l.base_quantity != null && Math.abs((l.price_per_base_unit as number) - (current.price_per_base_unit as number)) < 0.005);
    if (open.length) openExtraNok = round2(diff * open.reduce((s, l) => s + (l.base_quantity as number), 0));
  }
  return {
    purchases: purchases.slice(-maxShown), current, previous, changePct, certainty, certaintyText,
    arithmetic: arithmeticFor(current, baseUnit), monthlyExtraNok, openExtraNok, baseUnit,
    suspicious: changePct != null && Math.abs(changePct) >= SUSPICIOUS_JUMP_PCT,
  };
}

/** Prisspørsmål med stort hopp blir «Sjekk pakning». Andre typer beholdes. */
export function refineType(type: DecisionType, facts: PriceFacts | null): DecisionType {
  return type === "pris" && facts?.suspicious ? "sjekk_pakning" : type;
}

export function previousText(p: Purchase | null, baseUnit: string | null): string {
  if (!p) return "Ingen tidligere kjøp";
  return `Forrige kjøp ${dateNo(p.date)} (${kr(p.price)}${baseUnit ? `/${baseUnit}` : ""})`;
}
