// Demo D – Prishopp (D3). Ren logikk (testes). Bare priser som har hoppet mer enn grensen vises;
// grensen er selskapets (standard 20 %) eller varens egen. Ingenting her godtar eller endrer priser.
import { supplierItemKey } from "@/fakturaer/lib/supplierItemKey";

export const DEFAULT_JUMP_PCT = 20;
export const JUMP_CHOICES = [10, 15, 20, 25, 30, 40, 50] as const;
const PRICE_REASONS = ["price_variance", "price_increase", "price_drop"];

export interface JumpLineInput {
  id: string; invoice_id: string; raw_material_id: string | null;
  supplier_sku: string | null; description: string | null;
  price_per_base_unit: number | null; expected_price_per_base_unit: number | null; price_variance_pct: number | null;
  review_reason: string | null;
  invoice_number: string | null; invoice_date: string | null; supplier_id: string | null;
  rm_name: string | null; rm_base_unit: string | null; rm_item_type: string | null;
}

export interface PriceJump {
  key: string; supplierId: string; itemKey: string; rawMaterialId: string;
  name: string; baseUnit: string | null; itemType: string | null;
  invoiceId: string; invoiceNumber: string | null; invoiceDate: string | null; lineId: string;
  oldPrice: number; newPrice: number; pct: number; limit: number; openLines: number;
}

const num = (v: unknown): number | null => { const n = Number(v); return v != null && Number.isFinite(n) ? n : null; };
export const isPriceLine = (reason: string | null | undefined) => (reason ?? "").split(",").some((r) => PRICE_REASONS.includes(r.trim()));

/**
 * Én rad per leverandørvare (leverandør + varenummer/navn), nyeste faktura. Bare rader der |avvik| er større enn
 * grensen for varen. Linjer uten gammel/ny pris eller uten kobling tas ikke med (ukjent ≠ prishopp).
 */
export function priceJumps(lines: readonly JumpLineInput[], limitFor: (rawMaterialId: string) => number): PriceJump[] {
  const groups = new Map<string, JumpLineInput[]>();
  for (const l of lines) {
    if (!l.raw_material_id || !l.supplier_id || !isPriceLine(l.review_reason)) continue;
    const k = supplierItemKey(l);
    if (!k) continue;
    const key = `${l.supplier_id}|${k}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const out: PriceJump[] = [];
  for (const [key, ls] of groups) {
    const sorted = [...ls].sort((a, b) => (b.invoice_date ?? "").localeCompare(a.invoice_date ?? "") || b.id.localeCompare(a.id));
    const l = sorted.find((x) => num(x.price_per_base_unit) != null && num(x.expected_price_per_base_unit) != null && num(x.price_variance_pct) != null);
    if (!l) continue;
    const oldPrice = num(l.expected_price_per_base_unit)!, newPrice = num(l.price_per_base_unit)!, pct = num(l.price_variance_pct)!;
    if (oldPrice <= 0 || newPrice <= 0) continue;
    const limit = limitFor(l.raw_material_id!);
    if (Math.abs(pct) <= limit) continue;
    out.push({
      key, supplierId: l.supplier_id!, itemKey: key.slice(key.indexOf("|") + 1), rawMaterialId: l.raw_material_id!,
      name: l.rm_name ?? l.description ?? "Uten navn", baseUnit: l.rm_base_unit, itemType: l.rm_item_type,
      invoiceId: l.invoice_id, invoiceNumber: l.invoice_number, invoiceDate: l.invoice_date, lineId: l.id,
      oldPrice, newPrice, pct, limit, openLines: ls.length,
    });
  }
  return out.sort((a, b) => (a.invoiceDate ?? "9999").localeCompare(b.invoiceDate ?? "9999") || Math.abs(b.pct) - Math.abs(a.pct));
}

/** Hvor mange linjer som ligger under grensen (føres rett på varen når de nye reglene er på). */
export function belowLimitCount(lines: readonly JumpLineInput[], limitFor: (rawMaterialId: string) => number): number {
  return lines.filter((l) => l.raw_material_id && isPriceLine(l.review_reason) && num(l.price_variance_pct) != null
    && Math.abs(num(l.price_variance_pct)!) <= limitFor(l.raw_material_id)).length;
}

export interface JumpCause { text: string; packageSuspect: boolean }
/** Årsakstekst. Et hopp nær et helt multiplum (×6, ×12, ×24 …) tyder på pris per pakning, ikke per enhet. */
export function jumpCause(j: Pick<PriceJump, "oldPrice" | "newPrice" | "baseUnit" | "itemType">, o: { hasAgreement: boolean }): JumpCause {
  const unit = j.baseUnit ?? "enhet";
  const ratio = j.newPrice / j.oldPrice;
  const near = (r: number) => { const k = Math.round(r); return k >= 2 && Math.abs(r - k) / k <= 0.04 ? k : null; };
  const up = ratio >= 4 ? near(ratio) : null;
  if (up) return { text: `Ser ut som pris per pakning på ${up}, ikke per ${unit}.`, packageSuspect: true };
  const down = ratio > 0 && ratio <= 0.25 ? near(1 / ratio) : null;
  if (down) return { text: `Ser ut som pris per ${unit}, ikke per pakning på ${down}.`, packageSuspect: true };
  const parts = [o.hasAgreement ? "Avviker fra avtalt pris." : "Ingen avtale eller varslet prisendring er registrert."];
  if (j.itemType === "videresalg") parts.push("Selges også videre.");
  return { text: parts.join(" "), packageSuspect: false };
}

/** «Brukes i N kalkyler. M varer faller under marginmålet.» Ukjent margin sies rett ut, aldri 0. */
export function consequenceText(recipes: number | null, falling: number | null, packageSuspect: boolean): { text: string; danger: boolean } {
  const r = recipes == null ? "Bruk i kalkyler er ukjent." : recipes === 0 ? "Brukes ikke i noen kalkyle." : `Brukes i ${recipes} ${recipes === 1 ? "kalkyle" : "kalkyler"}.`;
  if (packageSuspect) return { text: `${r} Vurderes ikke før pakningen er sjekket.`, danger: false };
  if (recipes === 0) return { text: r, danger: false };
  if (falling == null) return { text: `${r} Marginvirkningen er ikke beregnet ennå.`, danger: false };
  if (falling === 0) return { text: `${r} Ingen varer faller under marginmålet.`, danger: false };
  return { text: `${r} ${falling} ${falling === 1 ? "vare faller" : "varer faller"} under marginmålet.`, danger: true };
}

export function formatPct(pct: number): string {
  const v = Math.round(pct);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("nb-NO")} %`;
}
