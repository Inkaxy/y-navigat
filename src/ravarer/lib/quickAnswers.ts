/**
 * Variant B – svarknappene direkte i spørsmålet (B1). Ren logikk: hvilke 2–3 knapper hver type får,
 * knappetekster, forhåndsvisning av pakningsretting og «Angre»-beskrivelser. Selve skrivingen går
 * alltid gjennom dagens skriveveier (rm_supplier_item_accept_price, leverandørsak, rm_link_supplier_item,
 * rm_set_invoice_exclusion) – og angring gjennom PENDING-funksjonene eller rm_reopen_invoice_exclusion.
 */
import type { DecisionType } from "./decisions";
import { formatNorwegianNumber } from "./quickFormat";

export type QuickKind = "godta" | "spor" | "kreditnota" | "pakning" | "hopp_alltid" | "hopp_en_gang" | "folgevare" | "velg_ravare";

/** Rekkefølge = viktigste svar først. Tom liste = svaret gis i panelet under. */
export function quickAnswersFor(type: DecisionType, o: { linked: boolean; locked: boolean }): QuickKind[] {
  if (o.locked) return [];
  switch (type) {
    case "pris": return o.linked ? ["godta", "spor", "pakning"] : [];
    case "sjekk_pakning": return o.linked ? ["pakning", "godta", "spor"] : [];
    case "over_avtale": return o.linked ? ["kreditnota", "godta", "pakning"] : [];
    case "pakning": return o.linked ? ["pakning", "hopp_alltid"] : ["velg_ravare", "hopp_alltid"];
    case "ukjent_vare": return ["velg_ravare", "hopp_alltid", "hopp_en_gang"];
    case "hopp_over": return ["hopp_alltid", "hopp_en_gang", "velg_ravare"];
    // Pant hoppes aldri over: følgevare (krever databaseendringen for Automatikk) eller koble.
    case "pant": return ["folgevare", "velg_ravare"];
    default: return [];
  }
}

const dm = (iso: string | null | undefined) => {
  if (!iso) return null;
  const [, m, d] = iso.split("-");
  return d && m ? `${d}.${m}` : null;
};

export function quickLabel(kind: QuickKind, c: { price?: number | null; unit?: string | null; date?: string | null; supplier?: string | null }): string {
  const who = c.supplier?.trim() || "leverandøren";
  switch (kind) {
    case "godta": {
      if (c.price == null || !Number.isFinite(c.price)) return "Ja, godta prisen";
      const d = dm(c.date);
      return `Ja, godta ${formatNorwegianNumber(c.price, 2)} kr/${c.unit ?? "enhet"}${d ? ` fra ${d}` : ""}`;
    }
    case "spor": return `Spør ${who} først`;
    case "kreditnota": return "Lag kreditnotaforslag";
    case "pakning": return "Pakningen er feil";
    case "hopp_alltid": return "Hopp over alltid";
    case "hopp_en_gang": return "Hopp over én gang";
    case "folgevare": return "Pant følger varen";
    case "velg_ravare": return "Velg råvare";
  }
}

/** Årsak for «hopp over», gjettet fra linjeteksten. Brukeren kan alltid velge en annen. */
export const SKIP_REASONS = ["Pall", "Miljøvederlag", "Frakt", "Gebyr/avgift", "Annet"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export function suggestSkipReason(text: string | null | undefined): SkipReason {
  const t = (text ?? "").toLowerCase();
  if (/pall/.test(t)) return "Pall";
  if (/miljø/.test(t)) return "Miljøvederlag";
  if (/frakt|drivstoff|levering/.test(t)) return "Frakt";
  if (/gebyr|avgift|tillegg/.test(t)) return "Gebyr/avgift";
  return "Annet";
}

// ---------- Pakningsretting med forhåndsvisning ----------
export interface PreviewLine {
  id: string; invoice_number: string | null; invoice_date: string | null;
  quantity: number | null; unit: string | null; total_amount: number | null;
  price_per_base_unit: number | null; expected_price_per_base_unit: number | null;
}
export interface PackagePreviewRow {
  id: string; invoiceNumber: string | null; invoiceDate: string | null;
  before: number | null; after: number | null;
  /** Endring i ny pris mot forventet (forrige kjøp/avtale). null = ukjent. */
  vsExpectedPct: number | null;
  /** Linjen er fakturert i grunnenheten selv – pakningen påvirker den ikke. */
  unaffected: boolean;
}
const isFinitePos = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const BASE_UNITS = new Set(["kg", "g", "l", "ml", "stk"]);

/**
 * Hva regnes om hvis én pakning inneholder `bupp` grunnenheter? Ny pris per grunnenhet = linjesum /
 * (mengde × bupp). Bare et anslag: serveren regner linjene på nytt ved lagring.
 */
export function packagePreview(lines: readonly PreviewLine[], bupp: number | null, baseUnit: string | null): PackagePreviewRow[] {
  return lines.map((l) => {
    const unit = (l.unit ?? "").trim().toLowerCase();
    const unaffected = !!unit && BASE_UNITS.has(unit) && unit === (baseUnit ?? "").toLowerCase();
    const after = unaffected ? l.price_per_base_unit
      : isFinitePos(bupp) && isFinitePos(l.quantity) && isFinitePos(l.total_amount) ? l.total_amount / (l.quantity * bupp) : null;
    const vs = after != null && isFinitePos(l.expected_price_per_base_unit) ? ((after - l.expected_price_per_base_unit) / l.expected_price_per_base_unit) * 100 : null;
    return { id: l.id, invoiceNumber: l.invoice_number, invoiceDate: l.invoice_date, before: l.price_per_base_unit, after, vsExpectedPct: vs, unaffected };
  });
}

// ---------- Angre ----------
export type UndoAnswer =
  | { kind: "pris"; lineIds: string[]; label: string; at: string }
  | { kind: "ikke_vare"; supplierId: string; itemKey: string; lineIds: string[]; label: string; at: string }
  | { kind: "en_gang"; lines: { invoiceId: string; lineId: string; updatedAt: string | null }[]; label: string; at: string };

/** Krever angringen PENDING-SQL (fase 1)? «Én gang» angres med dagens rm_reopen_invoice_exclusion. */
export const undoNeedsSql = (u: UndoAnswer): boolean => u.kind !== "en_gang";

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length > 0);

/** Streng lesing av lagret «siste svar». Alt uventet = null (ingen «Angre siste»). */
export function parseUndoAnswer(v: unknown): UndoAnswer | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.label !== "string" || typeof o.at !== "string") return null;
  if (o.kind === "pris" && isStrArr(o.lineIds)) return { kind: "pris", lineIds: o.lineIds, label: o.label, at: o.at };
  if (o.kind === "ikke_vare" && isStrArr(o.lineIds) && typeof o.supplierId === "string" && typeof o.itemKey === "string" && /^(sku|name):/.test(o.itemKey)) {
    return { kind: "ikke_vare", supplierId: o.supplierId, itemKey: o.itemKey, lineIds: o.lineIds, label: o.label, at: o.at };
  }
  if (o.kind === "en_gang" && Array.isArray(o.lines) && o.lines.length > 0) {
    const lines: { invoiceId: string; lineId: string; updatedAt: string | null }[] = [];
    for (const x of o.lines) {
      if (!x || typeof x !== "object") return null;
      const r = x as Record<string, unknown>;
      if (typeof r.invoiceId !== "string" || typeof r.lineId !== "string") return null;
      lines.push({ invoiceId: r.invoiceId, lineId: r.lineId, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null });
    }
    return { kind: "en_gang", lines, label: o.label, at: o.at };
  }
  return null;
}

const KEY = (companyId: string) => `nbhub:beslutninger:siste-svar:${companyId}`;
/** «Angre siste» lever i fanen (sessionStorage) per selskap; aldri på tvers av selskap. */
export function saveLastAnswer(companyId: string, u: UndoAnswer): void {
  try { sessionStorage.setItem(KEY(companyId), JSON.stringify(u)); } catch { /* lagring kan være sperret */ }
}
export function loadLastAnswer(companyId: string): UndoAnswer | null {
  try { const raw = sessionStorage.getItem(KEY(companyId)); return raw ? parseUndoAnswer(JSON.parse(raw)) : null; } catch { return null; }
}
export function clearLastAnswer(companyId: string): void {
  try { sessionStorage.removeItem(KEY(companyId)); } catch { /* ignorer */ }
}

export interface UndoOutcome { undone: number; skipped: { id: string; reason: string }[]; removedRules: number }
/** Svar fra rm_undo_price_acceptance / rm_undo_not_item. null = ukjent svar (aldri «angret»). */
export function parseUndoResult(v: unknown): UndoOutcome | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (o.ok !== true || !Array.isArray(o.undone) || !Array.isArray(o.skipped)) return null;
  const skipped: { id: string; reason: string }[] = [];
  for (const s of o.skipped) {
    if (!s || typeof s !== "object") return null;
    const r = s as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.reason !== "string") return null;
    skipped.push({ id: r.id, reason: r.reason });
  }
  const removed = Array.isArray(o.removed_rules) ? o.removed_rules.length : 0;
  return { undone: o.undone.length, skipped, removedRules: removed };
}

const UNDO_SKIP: Record<string, string> = {
  ikke_godtatt: "linjen var ikke godtatt",
  allerede_apen: "linjen er allerede åpen",
  annen_bruker: "svaret ble gitt av en annen (krever godkjenner)",
  faktura_last: "fakturaen er avstemt, flagget eller lukket",
  faktura_godkjent: "fakturaen er internt godkjent",
  kostpris_fort: "kostpris er ført fra linjen",
  ikke_merket: "linjen er ikke merket «Ikke vare»",
  holdt_utenfor: "linjen er holdt utenfor (gjenåpnes på fakturaen)",
  finnes_ikke: "linjen finnes ikke lenger",
};
export const undoSkipText = (reason: string): string => UNDO_SKIP[reason] ?? "kunne ikke angres";

export function undoSummary(o: UndoOutcome): string {
  const parts: string[] = [];
  parts.push(o.undone === 0 ? "Ingenting ble angret." : `${o.undone} ${o.undone === 1 ? "linje er" : "linjer er"} åpne spørsmål igjen.`);
  if (o.removedRules > 0) parts.push(o.removedRules === 1 ? "Regelen for fremtidige fakturaer er fjernet." : `${o.removedRules} regler for fremtidige fakturaer er fjernet.`);
  if (o.skipped.length > 0) {
    const why = [...new Set(o.skipped.map((s) => undoSkipText(s.reason)))];
    parts.push(`${o.skipped.length} kunne ikke angres: ${why.join("; ")}.`);
  }
  return parts.join(" ");
}
