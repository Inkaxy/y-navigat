// Demo D «Fra faktura til vare» – Nye varer (D1/D2). Ren logikk (testes).
// Én rad per leverandørvare (samme nøkkel som rm_link_supplier_item). Ingenting her skriver data.
import { normalizeUnit, parseDecimal, parsePackageFromDescription, stripPackageTokens, toBaseFactor } from "@/fakturaer/lib/units";
import { PANT_RE, SKIP_RE } from "@/ravarer/lib/decisions";
import type { LineMath } from "./lineMath";

export type NewItemType = "ravare" | "videresalg" | "emballasje";
export const NEW_ITEM_TYPES: readonly NewItemType[] = ["ravare", "videresalg", "emballasje"];
export const NEW_ITEM_TYPE_LABEL: Record<NewItemType, string> = { ravare: "Råvare", videresalg: "Handelsvare", emballasje: "Emballasje" };
export const CREATE_LABEL: Record<NewItemType, string> = { ravare: "Opprett råvare", videresalg: "Opprett handelsvare", emballasje: "Opprett emballasje" };
export const isNewItemType = (v: unknown): v is NewItemType => typeof v === "string" && (NEW_ITEM_TYPES as readonly string[]).includes(v);

/** Ser linjeteksten ut som frakt, gebyr, pall, miljøvederlag eller pant? Bare et merke – brukeren avgjør. */
export function looksLikeNotItem(text: string | null | undefined): boolean {
  const t = text ?? "";
  return SKIP_RE.test(t) || PANT_RE.test(t);
}

const UPPER = /^[^a-zæøå]*$/;
const COUNT_RE = /\b\d+\s*(?:stk|pk|pcs)\b\.?/gi;
const SACK_RE = /\b(?:sk|sekk|krt|kart)\.?\s*\d+([.,]\d+)?\b/gi;
/** Varenavn ryddet fra fakturateksten: uten pakningsstørrelse, «50%» → «50 %», stor forbokstav. */
export function cleanItemName(text: string | null | undefined): string {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  let s = raw.replace(/(\d)\s*%/g, "$1 %");
  const p = parsePackageFromDescription(s);
  if (p?.matched) s = s.replace(p.matched, " ");
  s = s.replace(COUNT_RE, " ").replace(SACK_RE, " ").replace(/\s{2,}/g, " ").replace(/[\s,.\-–/]+$/, "").trim();
  if (!s) s = raw;
  if (UPPER.test(s)) s = s.toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PACKAGING_RE = /(kakeeske|eske|bakepapir|bærepose|brødpose|pose\b|folie|beger|lokk|serviett|tape|etikett|hanske|plastfilm|kakebrett|kakepapp|sugerør|kopp|tallerken|bestikk|kartong)/i;
const RESALE_RE = /(\bcola\b|coca|pepsi|fanta|sprite|solo\b|brus|juice|mineralvann|farris|imsdal|\bøl\b|chips|snacks|tyggegummi|godteri|energidrikk|iste|smoothie)/i;

/** Varetype for «Opprett som ny»: leverandørens regel først, ellers gjettet fra teksten, ellers råvare. */
export function guessItemType(text: string | null | undefined, supplierRule: NewItemType | null): NewItemType {
  if (supplierRule) return supplierRule;
  const t = text ?? "";
  if (RESALE_RE.test(t)) return "videresalg";
  if (PACKAGING_RE.test(t)) return "emballasje";
  return "ravare";
}

// ---------- Pakning ----------
export const CONTENT_UNITS = ["kg", "g", "l", "ml", "stk"] as const;
export type ContentUnit = (typeof CONTENT_UNITS)[number];

export interface PackageLine {
  unit: string | null;
  quantity: number | null;
  total_amount: number | null;
  description: string | null;
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
}

export type PackageSource = "bekreftet" | "lest" | "varenavn" | "direkte" | "ingen";
export interface PackageDraft {
  /** Beholderen slik fakturaen skriver den (pose, sekk, kartong …). */
  container: string;
  /** Mengde som brukeren skriver (norsk tall). Tom = mangler. */
  qty: string;
  unit: ContentUnit;
  source: PackageSource;
  /** To kilder som ikke stemmer: vises med «Kontroller», aldri «Sikker». */
  conflict: boolean;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
function asContent(u: string | null | undefined): ContentUnit | null {
  const n = normalizeUnit(u);
  if (n === "kg" || n === "g" || n === "l" || n === "ml" || n === "stk") return n;
  if (n === "cl" || n === "dl") return "ml";
  return null;
}
function inMl(size: number, u: string): { size: number; unit: ContentUnit } {
  const n = normalizeUnit(u);
  if (n === "cl") return { size: size * 10, unit: "ml" };
  if (n === "dl") return { size: size * 100, unit: "ml" };
  return { size, unit: asContent(u) ?? "stk" };
}
const same = (a: { size: number; unit: ContentUnit }, b: { size: number; unit: ContentUnit }) => {
  const f = toBaseFactor(a.unit, b.unit);
  return f != null && Math.abs(a.size * f - b.size) <= Math.max(0.001, 0.015 * b.size);
};

/**
 * Pakningsforslag fra det som er lest av fakturaen. Fakturert i en grunnenhet (kg, l, stk …) = ingen pakning
 * trengs. Ellers lest pakning (package_size × count_per_package) og varenavnet; to kilder som ikke stemmer gir
 * `conflict`. Bekreftet pakning på koblingen vinner alltid.
 */
export function packageProposal(line: PackageLine | null, confirmed?: { size: number; unit: string } | null, math?: LineMath | null): PackageDraft {
  const container = (line?.unit ?? "").trim().toLowerCase();
  if (confirmed && confirmed.size > 0 && asContent(confirmed.unit)) {
    const c = inMl(confirmed.size, confirmed.unit);
    return { container, qty: fmt(c.size), unit: c.unit, source: "bekreftet", conflict: false };
  }
  const direct = asContent(line?.unit);
  if (direct) return { container: direct, qty: "1", unit: direct, source: "direkte", conflict: false };
  // Stk per beholder: lest antall, ellers det regnestykket viser (1 eske = 6 stk).
  const count = line?.count_per_package != null && line.count_per_package > 0 ? line.count_per_package : math?.subUnits ?? 1;
  const hasSize = !!line && line.package_size != null && line.package_size > 0 && !!asContent(line.package_unit);
  const read = hasSize ? inMl(line!.package_size! * count, line!.package_unit!) : null;
  const single = hasSize ? inMl(line!.package_size!, line!.package_unit!) : null;
  const p = parsePackageFromDescription(line?.description ?? null);
  const fromName = p && asContent(p.unit) ? inMl(p.size * (p.count || 1), p.unit) : null;
  // Varenavnet viser ofte størrelsen per stk («0,7L») – det er ikke strid med 6 × 0,7 l.
  if (read && fromName) return { container, qty: fmt(read.size), unit: read.unit, source: "lest", conflict: !same(read, fromName) && !(single && same(single, fromName)) };
  if (read) return { container, qty: fmt(read.size), unit: read.unit, source: "lest", conflict: false };
  if (fromName) return { container, qty: fmt(fromName.size), unit: fromName.unit, source: "varenavn", conflict: false };
  if (math?.subUnits != null && math.subUnits > 1) return { container, qty: String(math.subUnits), unit: "stk", source: "lest", conflict: false };
  return { container, qty: "", unit: "kg", source: "ingen", conflict: false };
}

/** Grunnenhet for en ny vare ut fra innholdsenheten (g → kg, ml → l). */
export function baseUnitForNew(unit: ContentUnit): "kg" | "l" | "stk" {
  return unit === "kg" || unit === "g" ? "kg" : unit === "l" || unit === "ml" ? "l" : "stk";
}

export type PackageState =
  | { state: "empty" }
  | { state: "invalid"; reason: string }
  | { state: "valid"; size: number; unit: ContentUnit; baseUnit: string; baseUnitsPerPackage: number; direct: boolean };

/** Tolker pakningen mot grunnenheten (koblet vare) eller enheten brukeren valgte (ny vare). */
export function readPackage(d: PackageDraft, baseUnit: string | null): PackageState {
  if (!d.qty.trim()) return { state: "empty" };
  const size = parseDecimal(d.qty);
  if (size == null || !(size > 0)) return { state: "invalid", reason: "Skriv et positivt tall." };
  const base = baseUnit ? normalizeUnit(baseUnit) : baseUnitForNew(d.unit);
  if (!base) return { state: "invalid", reason: "Varen mangler grunnenhet." };
  const f = toBaseFactor(d.unit, base);
  if (f == null) {
    const kind = base === "stk" ? "et antall stk" : base === "kg" ? "vekt (g eller kg)" : "volum (ml eller l)";
    return { state: "invalid", reason: `Varen regnes i ${base}, så innholdet må være ${kind}.` };
  }
  return { state: "valid", size, unit: d.unit, baseUnit: base, baseUnitsPerPackage: size * f, direct: d.source === "direkte" };
}

/**
 * Pris per grunnenhet for linjen: beløp ÷ (antall × innhold). Null = ukjent, aldri 0.
 * `units` = antallet regnestykket viser (lineMath); null der = ukjent antall → ingen pris.
 */
export function pricePerBase(line: Pick<PackageLine, "quantity" | "total_amount"> | null, s: PackageState, units?: number | null): number | null {
  if (!line || s.state !== "valid" || units === null) return null;
  const q = units !== undefined ? units : Number(line.quantity), t = Number(line.total_amount);
  if (!Number.isFinite(q) || !Number.isFinite(t) || q <= 0 || t <= 0) return null;
  const v = t / (q * s.baseUnitsPerPackage);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Lagringsform for link-supplier-item. Direkte fakturert (kg på faktura for kg-vare) trenger ingen pakning. */
export function packagePayload(s: PackageState): { package_size: number; package_unit: string; base_units_per_package: number; confirm: true } | null {
  if (s.state !== "valid" || s.direct) return null;
  return { package_size: s.size, package_unit: s.unit, base_units_per_package: s.baseUnitsPerPackage, confirm: true };
}

export type PackageBadge = "sikker" | "kanskje" | "fyll_inn" | "ikke_vare" | "kontroller" | "sjekk_tall";
export const PACKAGE_BADGE_LABEL: Record<PackageBadge, string> = {
  sikker: "Sikker", kanskje: "Finnes kanskje fra før", fyll_inn: "Fyll inn pakning", ikke_vare: "Ser ikke ut som en vare", kontroller: "Kontroller pakningen", sjekk_tall: "Sjekk tallene",
};

/**
 * Merket i pakningsraden. Rekkefølge: ikke vare → mangler → tallene går ikke opp → kilder i strid → forslag finnes → sikker.
 * `numbersOk=false`: linjen prisen bygger på har merknad i lesekontrollen – aldri «Sikker».
 */
export function packageBadge(o: { text: string | null; draft: PackageDraft; state: PackageState; mode: RowMode; hasSuggestion: boolean; numbersOk?: boolean }): PackageBadge {
  if (looksLikeNotItem(o.text)) return "ikke_vare";
  if (o.state.state !== "valid") return "fyll_inn";
  if (o.numbersOk === false) return "sjekk_tall";
  if (o.draft.conflict) return "kontroller";
  if (o.mode === "koble" && o.hasSuggestion) return "kanskje";
  return "sikker";
}

// ---------- Forslag og søk ----------
export interface Candidate { id: string; name: string; sku: string | null; declaration_name: string | null; item_type: string | null; base_unit: string | null; cost: number | null }

const STOP = new Set(["og", "med", "uten", "til", "for", "the", "stk", "krt", "sek", "sekk", "pose", "pk"]);
function tokens(s: string | null | undefined): Set<string> {
  return new Set(stripPackageTokens(s ?? "").split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOP.has(w)));
}
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t) || [...B].some((u) => (u.length >= 5 && t.startsWith(u)) || (t.length >= 5 && u.startsWith(t)))) hit++;
  return hit / Math.max(A.size, B.size);
}

export const SUGGEST_MIN = 0.6;
/** Beste eksisterende vare for fakturateksten (navn eller deklarasjonsnavn). Null = ingen god nok. */
export function suggestCandidate(text: string | null | undefined, candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  let score = 0;
  for (const c of candidates) {
    const s = Math.max(nameSimilarity(text, c.name), nameSimilarity(text, c.declaration_name));
    if (s > score || (s === score && best && c.name.localeCompare(best.name, "nb") < 0)) { best = c; score = s; }
  }
  return best && score >= SUGGEST_MIN ? best : null;
}

/** Søk i råvarer, handelsvarer og emballasje på navn, SKU og deklarasjonsnavn. */
export function searchCandidates(q: string, candidates: readonly Candidate[], limit = 8): Candidate[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const parts = t.split(/\s+/);
  return candidates
    .filter((c) => { const h = `${c.name} ${c.sku ?? ""} ${c.declaration_name ?? ""}`.toLowerCase(); return parts.every((p) => h.includes(p)); })
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) || a.name.localeCompare(b.name, "nb"))
    .slice(0, limit);
}

// ---------- Rader ----------
export type RowMode = "koble" | "opprett";
/** Standard: «Koble» når det finnes et forslag eller en kobling, ellers «Opprett som ny». */
export const defaultMode = (hasSuggestion: boolean): RowMode => (hasSuggestion ? "koble" : "opprett");

export interface RowAnswer { mode: RowMode; type: NewItemType; name: string; pick: Candidate | null; badge: PackageBadge; state: PackageState; existingMatch?: boolean }
/** «Opprett N sikre»: bare «Opprett som ny» med navn, type og sikker pakning – og ingen vare med samme varenummer fra før. */
export function isSafeCreate(a: RowAnswer): boolean {
  return a.mode === "opprett" && a.existingMatch !== true && a.name.trim().length > 0 && a.badge === "sikker" && a.state.state === "valid";
}
/** Primærknappen er sperret til mengden er fylt inn (og til en vare er valgt ved kobling). */
export function canSubmit(a: RowAnswer): boolean {
  if (a.state.state !== "valid") return false;
  return a.mode === "koble" ? !!a.pick : a.name.trim().length > 0;
}

/** Andre skrivemåter leverandøren har brukt for samme vare (uten den som vises). */
export function otherSpellings(shown: string | null | undefined, all: readonly (string | null | undefined)[], max = 3): string[] {
  const seen = new Set<string>([(shown ?? "").trim().toLowerCase()]);
  const out: string[] = [];
  for (const d of all) {
    const v = (d ?? "").trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export interface QueueRow { key: string; supplier_id: string | null; supplier_name: string | null; kind: string; first_open_date?: string | null; last_date: string | null }
/** Eldste først (ren sortering), ukoblede foran «mangler pakning» ved lik dato. */
export function sortQueue<T extends QueueRow>(rows: readonly T[]): T[] {
  const d = (r: T) => r.first_open_date ?? r.last_date ?? "9999-12-31";
  return [...rows].sort((a, b) => d(a).localeCompare(d(b)) || Number(a.kind !== "ukoblet") - Number(b.kind !== "ukoblet") || a.key.localeCompare(b.key));
}

/** Leverandørchips med antall: «Alle leverandører» først, så flest først. */
export function supplierChips(rows: readonly QueueRow[]): { id: string | null; name: string; count: number }[] {
  const m = new Map<string, { id: string; name: string; count: number }>();
  for (const r of rows) {
    if (!r.supplier_id) continue;
    const c = m.get(r.supplier_id) ?? { id: r.supplier_id, name: r.supplier_name ?? "Ukjent leverandør", count: 0 };
    c.count++;
    m.set(r.supplier_id, c);
  }
  return [{ id: null, name: "Alle leverandører", count: rows.length }, ...[...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "nb"))];
}

// ---------- Kreditnota (opprydding demo D) ----------
type CreditLine = { is_credit_note?: boolean | null; quantity?: number | null; total_amount?: number | null };
/** Kreditlinje: på en kreditnota, eller negativ mengde/beløp. Slike linjer spør aldri om pakning. */
export function isCreditLine(l: CreditLine): boolean {
  return l.is_credit_note === true || (l.quantity != null && Number(l.quantity) < 0) || (l.total_amount != null && Number(l.total_amount) < 0);
}
/** Raden er en kreditnota-rad når alle åpne linjer er kreditlinjer (minst én). */
export function isCreditRow(open: readonly CreditLine[]): boolean {
  return open.length > 0 && open.every(isCreditLine);
}
/**
 * Linjen pakningsforslaget og prisen bygges fra: aldri en kreditlinje. Med `clean`: en linje som er lest rent
 * (åpen først, så eldre) foran en med merknad i lesekontrollen.
 */
export function packageSourceLine<T extends CreditLine>(open: readonly T[], all: readonly T[], clean?: (l: T) => boolean): T | null {
  if (clean) {
    const c = open.find((l) => !isCreditLine(l) && clean(l)) ?? all.find((l) => !isCreditLine(l) && clean(l));
    if (c) return c;
  }
  return open.find((l) => !isCreditLine(l)) ?? all.find((l) => !isCreditLine(l)) ?? null;
}
