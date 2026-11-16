/**
 * Variant B – Prislinje (B4): én linje per råvare og leverandør. Ren logikk for søylene, «klar for bruk»,
 * avviksgrense/periode og strenge parsere for rettingene (PENDING-SQL fase 2).
 */
import { historyKind, type TimelineHistoryRow } from "./priceTimeline";
import { compareOldestFirst } from "./allPrices";

export interface PrislinjeRow {
  id: string; rawMaterialId: string; supplierId: string; rmName: string; supplierName: string; baseUnit: string;
  itemType: string | null; category: string | null; currentCost: number | null; costStatus: string | null;
  allergensReviewedAt: string | null; declarationName: string | null; isPrimary: boolean;
  packageSize: number | null; packageUnit: string | null; buPerPackage: number | null; containerUnit: string | null;
  packageConfirmedAt: string | null; lastInvoiceDate: string | null; updatedAt: string; rmUpdatedAt: string;
}

export function filterPrislinje(rows: readonly PrislinjeRow[], q: string): PrislinjeRow[] {
  const s = q.trim().toLowerCase();
  const out = s ? rows.filter((r) => r.rmName.toLowerCase().includes(s) || r.supplierName.toLowerCase().includes(s)) : [...rows];
  return out.sort((a, b) => a.rmName.localeCompare(b.rmName, "nb") || a.supplierName.localeCompare(b.supplierName, "nb") || a.id.localeCompare(b.id));
}

export type ReadyKey = "kost" | "pakning" | "allergener" | "naering" | "dekl";
export const READY_LABEL: Record<ReadyKey, string> = { kost: "Kost", pakning: "Pakning", allergener: "Allergener", naering: "Næring", dekl: "Dekl.navn" };
export interface ReadyCheck { key: ReadyKey; ok: boolean | null }

/** Klar for bruk. Allergener/næring/deklarasjonsnavn gjelder bare råvarer (ikke emballasje/videresalg). null = ukjent. */
export function readiness(r: PrislinjeRow, hasNutrition: boolean | null): ReadyCheck[] {
  const checks: ReadyCheck[] = [
    { key: "kost", ok: r.costStatus === "verifisert" },
    { key: "pakning", ok: !!r.packageConfirmedAt },
  ];
  if ((r.itemType ?? "ravare") === "ravare") {
    checks.push({ key: "allergener", ok: !!r.allergensReviewedAt }, { key: "naering", ok: hasNutrition }, { key: "dekl", ok: !!r.declarationName?.trim() });
  }
  return checks;
}

export type BarStatus = "godkjent" | "regel" | "venter" | "kontroll";
export const BAR_LABEL: Record<BarStatus, string> = { godkjent: "Godkjent", regel: "Av regelen", venter: "Venter på deg", kontroll: "Til kontroll" };
export interface Bar { key: string; date: string; price: number; status: BarStatus; changePct: number | null }
export interface OpenPurchase { id: string; date: string; price: number | null }

/**
 * Søyler eldste → nyeste for én leverandør: gyldige observasjoner (Godkjent av bruker / Av regelen),
 * holdte (Til kontroll) og åpne linjer (Venter på deg). Endring måles mot forrige søyle med kjent pris.
 */
export function barsFor(history: readonly TimelineHistoryRow[], supplierId: string, currentUnit: string | null, open: readonly OpenPurchase[]): Bar[] {
  const rows = history.filter((h) => h.supplier_id === supplierId).sort(compareOldestFirst);
  const bars: Omit<Bar, "changePct">[] = [];
  for (const h of rows) {
    const k = historyKind(h, currentUnit);
    const price = Number(h.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (k === "gyldig") bars.push({ key: h.id, date: h.effective_date, price, status: h.createdBy ? "godkjent" : "regel" });
    else if (h.held) bars.push({ key: h.id, date: h.effective_date, price, status: "kontroll" });
  }
  for (const o of open) if (o.price != null && Number.isFinite(o.price) && o.price > 0) bars.push({ key: `apen:${o.id}`, date: o.date, price: o.price, status: "venter" });
  bars.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
  let prev: number | null = null;
  return bars.map((b) => {
    const changePct = prev != null && prev > 0 ? ((b.price - prev) / prev) * 100 : null;
    prev = b.price;
    return { ...b, changePct };
  });
}

/** Avviksgrense: egen innstilling når satt, ellers kategoriens toleranse (som før). */
export function effectiveThreshold(settingPct: number | null | undefined, categoryPct: number | null): number | null {
  if (settingPct != null && Number.isFinite(settingPct) && settingPct >= 0) return settingPct;
  return categoryPct;
}

/** «Vis priser siden»: samme dato N måneder tilbake (standard 12). Ingen nedre grense; «Alle» viser alt. */
export function sinceMonthsBack(todayIso: string, months: number): string {
  const [y, m, d] = todayIso.split("-").map(Number);
  const total = y * 12 + (m - 1) - Math.max(0, Math.round(months));
  const ny = Math.floor(total / 12); const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Kan raden rettes? Bare aktive, ikke-kreditte, ikke-eldre observasjoner. */
export const correctable = (r: TimelineHistoryRow): boolean => !r.supersededAt && !r.isLegacy && !r.isCredit && Number(r.price) > 0;

// ---------- Svar fra PENDING-funksjonene ----------
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export type CorrectionResult =
  | { kind: "preview"; oldPrice: number; newPrice: number; costBefore: number | null; costAfter: number | null; costStatusAfter: string | null }
  | { kind: "saved"; already: boolean; oldPrice: number | null; newPrice: number; costAfter: number | null }
  | { kind: "rejected"; error: string }
  | { kind: "unknown" };

export function parseCorrection(v: unknown): CorrectionResult {
  const o = obj(v);
  if (!o) return { kind: "unknown" };
  if (o.ok === false && typeof o.error === "string") return { kind: "rejected", error: o.error };
  if (o.ok !== true) return { kind: "unknown" };
  const newPrice = numOrNull(o.new_price);
  if (o.dry_run === true) {
    const oldPrice = numOrNull(o.old_price);
    if (oldPrice == null || newPrice == null) return { kind: "unknown" };
    return { kind: "preview", oldPrice, newPrice, costBefore: numOrNull(o.cost_before), costAfter: numOrNull(o.cost_after), costStatusAfter: typeof o.cost_status_after === "string" ? o.cost_status_after : null };
  }
  if (o.dry_run === false && newPrice != null) return { kind: "saved", already: o.already === true, oldPrice: numOrNull(o.old_price), newPrice, costAfter: numOrNull(o.cost_after) };
  return { kind: "unknown" };
}

export type PackageChangeResult =
  | { kind: "preview"; openLines: number; openInvoices: number; lines: { lineId: string; invoiceNumber: string | null; invoiceDate: string | null; before: number | null; after: number | null }[] }
  | { kind: "saved"; already: boolean; requeued: number; openLines: number }
  | { kind: "rejected"; error: string }
  | { kind: "unknown" };

export function parsePackageChange(v: unknown): PackageChangeResult {
  const o = obj(v);
  if (!o) return { kind: "unknown" };
  if (o.ok === false && typeof o.error === "string") return { kind: "rejected", error: o.error };
  if (o.ok !== true) return { kind: "unknown" };
  if (o.dry_run === true) {
    const open = numOrNull(o.open_lines); const inv = numOrNull(o.open_invoices);
    if (open == null || inv == null || !Array.isArray(o.lines)) return { kind: "unknown" };
    const lines = o.lines.flatMap((x) => {
      const r = obj(x); if (!r || typeof r.line_id !== "string") return [];
      return [{ lineId: r.line_id, invoiceNumber: typeof r.invoice_number === "string" ? r.invoice_number : null, invoiceDate: typeof r.invoice_date === "string" ? r.invoice_date : null,
        before: numOrNull(r.price_per_base_unit), after: numOrNull(r.new_price_per_base_unit) }];
    });
    return { kind: "preview", openLines: open, openInvoices: inv, lines };
  }
  if (o.dry_run === false) return { kind: "saved", already: o.already === true, requeued: numOrNull(o.requeued) ?? 0, openLines: numOrNull(o.open_lines) ?? 0 };
  return { kind: "unknown" };
}

const CORRECTION_ERROR: Record<string, string> = {
  op_mangler: "Teknisk feil. Lukk og åpne på nytt.",
  op_gjenbrukt: "Denne rettingen er allerede sendt med andre verdier. Lukk og start på nytt.",
  finnes_ikke: "Kjøpet finnes ikke lenger.",
  allerede_erstattet: "Kjøpet er allerede rettet eller erstattet. Last inn på nytt.",
  kan_ikke_rettes: "Eldre eller kreditterte observasjoner kan ikke rettes her.",
  valuta: "Bare priser i norske kroner kan rettes her.",
  enhet_endret: "Råvarens grunnenhet er endret siden kjøpet. Prisen kan ikke rettes i dagens enhet.",
  ugyldig_pris: "Skriv en pris over 0.",
  samme_pris: "Prisen er den samme som før.",
  begrunnelse_mangler: "Skriv en begrunnelse på minst 5 tegn.",
  versjon_endret: "Leverandørkoblingen er endret siden du åpnet den. Last inn på nytt.",
  ugyldig_pakning: "Skriv en gyldig pakning.",
  samme_pakning: "Pakningen er den samme som den godkjente.",
  retting_erstattet: "Rettingen er selv rettet senere og kan ikke angres herfra.",
  original_aktiv: "Det opprinnelige kjøpet er allerede aktivt.",
  konflikt: "Et annet aktivt kjøp bruker samme fakturalinje. Kontroller historikken.",
  ikke_prisretting: "Dette er ikke en prisretting.",
};
export const correctionErrorText = (code: string): string => CORRECTION_ERROR[code] ?? "Ble avvist. Ingenting er endret.";

export interface CorrectionLogRow { id: string; kind: "price" | "package"; at: string; reason: string; by: string; reverted: boolean; summary: string }
export function parseCorrectionLog(v: unknown, unit: string): CorrectionLogRow[] | null {
  if (!Array.isArray(v)) return null;
  const out: CorrectionLogRow[] = [];
  for (const x of v) {
    const r = obj(x);
    if (!r || typeof r.id !== "string" || (r.kind !== "price" && r.kind !== "package") || typeof r.corrected_at !== "string" || typeof r.reason !== "string" || typeof r.corrected_by !== "string") return null;
    const b = obj(r.before) ?? {}; const a = obj(r.after) ?? {};
    const fmt = (n: number | null) => (n == null ? "?" : n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const summary = r.kind === "price"
      ? `Pris rettet ${fmt(numOrNull(b.price))} → ${fmt(numOrNull(a.price))} kr/${unit}${typeof b.invoice_number === "string" ? ` (faktura ${b.invoice_number})` : ""}`
      : `Godkjent pakning ${numOrNull(b.base_units_per_package)?.toLocaleString("nb-NO") ?? "?"} → ${numOrNull(a.base_units_per_package)?.toLocaleString("nb-NO") ?? "?"} ${unit} per pakning`;
    out.push({ id: r.id, kind: r.kind, at: r.corrected_at, reason: r.reason, by: r.corrected_by, reverted: typeof r.reverted_at === "string", summary });
  }
  return out;
}
