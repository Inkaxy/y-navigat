// ÉN rapportkontrakt for varetelling: skjerm, nedlastet PDF/CSV og e-post bruker denne (ren TS, ingen Deno/DOM).
// Ligger under pending/functions/_shared slik at Edge-kilden kan importere den uten src/.
// Regler: verdi = mengde × pris avrundet half-up til øre PER LINJE (eksakt desimal), deretter summert i øre.
// Bare «talt» med pris har verdi; «0 på lager» har verdi 0; alt annet (ikke talt, ikke her, må kontrolleres,
// talt uten pris) er ukjent — aldri 0.

export type VtLineState = "ikke_talt" | "talt" | "null" | "ikke_her" | "ma_kontrolleres";
export interface VtReportCount {
  id: string; name: string; planned_date: string; status: string; revision: number;
  valuation_mode: string; valuation_date: string | null; finished_at: string | null;
}
export interface VtReportList { id: string; name: string; department: string; status: string; sort_order: number; source_template_revision: number }
export interface VtReportLine {
  id: string; count_list_id: string; raw_material_id: string; sort_order: number; snap_name: string; snap_sku: string | null; snap_location_name: string | null;
  snap_base_unit: string | null; snap_price_per_base: number | null; snap_price_source: string; snap_price_reason: string | null;
  snap_price_effective_date: string | null; snap_price_known_after_valuation: boolean;
  state: VtLineState; counted_base: number | null; note: string | null; revision: number;
}
export interface VtReportData { count: VtReportCount; lists: VtReportList[]; lines: VtReportLine[]; generatedAt: string }

export const LINE_STATE_TEXT: Record<VtLineState, string> = {
  ikke_talt: "Ikke talt", talt: "Talt", null: "0 på lager", ikke_her: "Ikke på dette stedet", ma_kontrolleres: "Må kontrolleres",
};
export const PRICE_REASON_TEXT: Record<string, string> = {
  enhet_ukjent: "Ukjent baseenhet", fakturatilgang_mangler: "Den som startet mangler fakturatilgang", ingen_dokumentert_pris: "Ingen dokumentert pris",
  pris_ugyldig: "Ugyldig pris", kostpris_ikke_bekreftet: "Kostprisen er ikke bekreftet mot nyeste dokumenterte pris", vare_ukjent: "Varen finnes ikke i firmaet",
};
export const priceReasonText = (r: string | null) => (r ? PRICE_REASON_TEXT[r] ?? "Pris mangler" : "Pris mangler");

// ---------- eksakt desimal ----------
/** Tall → [heltall, skala] eksakt fra kortest desimalrepresentasjon (håndterer eksponentform). */
function toScaled(n: number): [bigint, number] {
  if (!Number.isFinite(n)) throw new Error("Ikke endelig tall");
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(s);
  if (!m) throw new Error("Tallformat");
  const digits = m[2] + (m[3] ?? ""); let scale = (m[3] ?? "").length - Number(m[4] ?? 0);
  let v = BigInt(digits);
  if (scale < 0) { v *= 10n ** BigInt(-scale); scale = 0; }
  return [m[1] === "-" ? -v : v, scale];
}
/** a × b i øre, half-up (bort fra null) på eksakt desimalprodukt. 1 × 1,005 = 1,01; 10,075 = 10,08. */
export function mulToOreHalfUp(a: number, b: number): number {
  const [x, sx] = toScaled(a); const [y, sy] = toScaled(b);
  const p = x * y; const scale = sx + sy - 2; // øre = ×100
  if (scale <= 0) return Number(p * 10n ** BigInt(-scale));
  const d = 10n ** BigInt(scale); const neg = p < 0n; const ap = neg ? -p : p;
  let q = ap / d; if ((ap % d) * 2n >= d) q += 1n;
  return Number(neg ? -q : q);
}

/** Linjeverdi i øre. null = ukjent (ikke 0). */
export function lineValueOre(l: Pick<VtReportLine, "state" | "counted_base" | "snap_price_per_base">): number | null {
  if (l.state === "null") return 0;
  if (l.state !== "talt" || l.counted_base == null || l.snap_price_per_base == null) return null;
  return mulToOreHalfUp(l.counted_base, l.snap_price_per_base);
}

export interface VtSummary {
  lines: number; counted: number; zero: number; notHere: number; notCounted: number; review: number;
  /** Sum av kjente linjeverdier i kroner (øre-eksakt). null bare når ingen linje har kjent verdi. */
  value: number | null;
  /** Talte linjer med mengde > 0 uten pris. */
  countedWithoutPrice: number;
  /** Alle linjer avklart, ingen må kontrolleres, og alle talte har pris. Da er `value` fullstendig. */
  complete: boolean;
}
export function summarizeLines(lines: Pick<VtReportLine, "state" | "counted_base" | "snap_price_per_base">[]): VtSummary {
  let counted = 0, zero = 0, notHere = 0, notCounted = 0, review = 0, cwp = 0, ore = 0, known = 0;
  for (const l of lines) {
    if (l.state === "talt") counted++; else if (l.state === "null") zero++; else if (l.state === "ikke_her") notHere++;
    else if (l.state === "ma_kontrolleres") review++; else notCounted++;
    if (l.state === "talt" && l.snap_price_per_base == null) cwp++;
    const v = lineValueOre(l); if (v != null) { known++; ore += v; }
  }
  return { lines: lines.length, counted, zero, notHere, notCounted, review, value: known > 0 ? ore / 100 : null, countedWithoutPrice: cwp,
    complete: lines.length > 0 && notCounted === 0 && review === 0 && cwp === 0 };
}
export interface VtGroup { key: string; label: string; summary: VtSummary }
export function summarizeGroupsOf(lists: Pick<VtReportList, "id" | "name" | "department">[], lines: VtReportLine[]): { byList: VtGroup[]; byDepartment: VtGroup[] } {
  const byList = lists.map(l => ({ key: l.id, label: `${l.department} · ${l.name}`, summary: summarizeLines(lines.filter(x => x.count_list_id === l.id)) }));
  const depts = [...new Set(lists.map(l => l.department))].sort((a, b) => a.localeCompare(b, "nb"));
  const byDepartment = depts.map(d => { const ids = new Set(lists.filter(l => l.department === d).map(l => l.id));
    return { key: d, label: d, summary: summarizeLines(lines.filter(x => ids.has(x.count_list_id))) }; });
  return { byList, byDepartment };
}

// ---------- formatering ----------
const nbNum = (n: number, max = 6) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: max, useGrouping: false }).format(n);
export const krText = (ore: number) => new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ore / 100);
const dateNo = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");
export const isFinal = (c: Pick<VtReportCount, "status">) => c.status === "avsluttet";
export const reportTitleOf = (c: VtReportCount) => `${c.name}${isFinal(c) ? "" : " — FORELØPIG"}`;
export function priceSourceText(l: VtReportLine): string {
  if (l.snap_price_per_base == null) return priceReasonText(l.snap_price_reason);
  const base = l.snap_price_source === "historisk_dokumentert" ? "Historisk dokumentert" : "Dokumentert kostpris";
  return l.snap_price_known_after_valuation ? `${base} (registrert etter verdsettelsesdato)` : base;
}
export function summaryText(s: VtSummary): string {
  const v = s.value == null ? "ukjent" : `${krText(Math.round(s.value * 100))} kr${s.complete ? "" : " (ufullstendig)"}`;
  return `${s.lines - s.notCounted}/${s.lines} registrert · verdi ${v}${s.countedWithoutPrice ? ` · ${s.countedWithoutPrice} talt uten pris` : ""}${s.review ? ` · ${s.review} må kontrolleres` : ""}${s.notCounted ? ` · ${s.notCounted} ikke talt` : ""}`;
}

/** Celle trygg mot formeltolkning i regneark og mot skilletegn. */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const orderLines = (d: VtReportData) => {
  const order = new Map(d.lists.map((l, i) => [l.id, i]));
  return [...d.lines].sort((a, b) => (order.get(a.count_list_id) ?? 0) - (order.get(b.count_list_id) ?? 0) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
};
export function buildReportCsv(d: VtReportData): string {
  const listOf = new Map(d.lists.map(l => [l.id, l]));
  const head = ["Telling", "Status", "Verdsettelsesdato", "Liste", "Avdeling", "Sted", "Varenr", "Vare", "Registrering", "Mengde", "Enhet",
    "Pris per enhet (NOK eks. mva)", "Priskilde", "Pris virkningsdato", "Pris registrert etter verdsettelsesdato", "Verdi (NOK)", "Merknad", "Linje-ID", "Linjerevisjon"];
  const status = isFinal(d.count) ? "Avsluttet" : `Foreløpig ${d.generatedAt}`;
  const rows = orderLines(d).map(l => {
    const list = listOf.get(l.count_list_id); const v = lineValueOre(l);
    const qtyShown = l.state === "talt" || l.state === "null" || (l.state === "ma_kontrolleres" && l.counted_base != null);
    return [d.count.name, status, d.count.valuation_date ?? "", list?.name ?? "", list?.department ?? "", l.snap_location_name ?? "", l.snap_sku ?? "", l.snap_name,
      LINE_STATE_TEXT[l.state], qtyShown && l.counted_base != null ? nbNum(l.counted_base) : "", l.snap_base_unit ?? "ukjent",
      l.snap_price_per_base == null ? "" : nbNum(l.snap_price_per_base), priceSourceText(l), l.snap_price_effective_date ?? "",
      l.snap_price_per_base == null ? "" : l.snap_price_known_after_valuation ? "Ja" : "Nei",
      v == null ? (l.state === "talt" ? "UKJENT (mangler pris)" : l.state === "ma_kontrolleres" ? "UKJENT (må kontrolleres)" : "") : krText(v),
      l.note ?? "", l.id, String(l.revision)];
  });
  return "\uFEFF" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
}

// ---------- felles rapportinnhold (blokker) ----------
export interface Block { text: string; size: number; bold: boolean; gapBefore: number }
export function reportBlocks(d: VtReportData): Block[] {
  const out: Block[] = []; const b = (text: string, size = 9, bold = false, gapBefore = 0) => out.push({ text, size, bold, gapBefore });
  b(reportTitleOf(d.count), 15, true);
  b(`Telledato ${dateNo(d.count.planned_date)} · verdsettelse ${dateNo(d.count.valuation_date)} (${d.count.valuation_mode === "historisk" ? "historisk dokumentert pris" : "dokumentert pris ved start"}) · beløp i NOK eks. mva · tellingsrevisjon ${d.count.revision}`, 10);
  b(isFinal(d.count) ? `Avsluttet ${d.count.finished_at ?? ""}` : `Foreløpig rapport generert ${d.generatedAt}. Tallene kan endres.`, 10);
  b(`Hele tellingen: ${summaryText(summarizeLines(d.lines))}`, 11, true, 2);
  const g = summarizeGroupsOf(d.lists, d.lines);
  b("Per avdeling", 11, true, 2); for (const x of g.byDepartment) b(`${x.label}: ${summaryText(x.summary)}`);
  b("Per liste", 11, true, 2); for (const x of g.byList) b(`${x.label}: ${summaryText(x.summary)}`);
  const missing = d.lines.filter(l => l.state === "talt" && l.snap_price_per_base == null);
  if (missing.length) { b("Talte varer uten pris (ikke regnet som 0)", 11, true, 2); for (const l of missing) b(`${l.snap_name} — ${l.counted_base == null ? "" : nbNum(l.counted_base)} ${l.snap_base_unit ?? ""} — ${priceReasonText(l.snap_price_reason)}`); }
  const late = d.lines.filter(l => l.snap_price_per_base != null && l.snap_price_known_after_valuation);
  if (late.length) { b("Priser registrert etter verdsettelsesdatoen", 11, true, 2); for (const l of late) b(`${l.snap_name} — virkningsdato ${dateNo(l.snap_price_effective_date)}`); }
  const ordered = orderLines(d);
  for (const list of d.lists) {
    b(`${list.department} · ${list.name} (malversjon ${list.source_template_revision})`, 11, true, 3);
    for (const l of ordered.filter(x => x.count_list_id === list.id)) {
      const v = lineValueOre(l);
      b(`${l.snap_sku ?? "—"}  ${l.snap_name}  ·  ${l.snap_location_name ?? "uten sted"}  ·  ${LINE_STATE_TEXT[l.state]}${l.counted_base != null && l.state !== "ikke_talt" && l.state !== "ikke_her" ? ` ${nbNum(l.counted_base)} ${l.snap_base_unit ?? ""}` : ""}  ·  ${l.snap_price_per_base == null ? priceReasonText(l.snap_price_reason) : `${nbNum(l.snap_price_per_base)} kr/${l.snap_base_unit}${l.snap_price_known_after_valuation ? " (registrert etter verdsettelsesdato)" : ""}`}  ·  ${v == null ? "ukjent verdi" : `${krText(v)} kr`}  ·  ID ${l.id}`);
    }
  }
  return out;
}

/** Bryter tekst til linjer med en målefunksjon (mm/pt). Ord lengre enn bredden deles — ingenting kastes. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean); const out: string[] = []; let cur = "";
  const push = (w: string) => {
    let rest = w;
    while (measure(rest) > maxWidth && rest.length > 1) {
      let k = rest.length - 1; while (k > 1 && measure(rest.slice(0, k)) > maxWidth) k--;
      out.push(rest.slice(0, k)); rest = rest.slice(k);
    }
    return rest;
  };
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (measure(cand) <= maxWidth) { cur = cand; continue; }
    if (cur) out.push(cur);
    cur = push(w);
  }
  if (cur || out.length === 0) out.push(cur);
  return out;
}

export interface PlacedLine { page: number; x: number; y: number; size: number; bold: boolean; text: string }
/**
 * Plasserer blokker på A4-sider (mm, topp→ned). Sidebrudd sjekkes FØR HVER brutte linje, så ingen tekst havner
 * utenfor arket. Sidetall «Side X av Y» legges i bunnteksten.
 */
export function layoutA4(blocks: Block[], measure: (s: string, size: number, bold: boolean) => number): { pages: number; lines: PlacedLine[] } {
  const L = 14, W = 182, TOP = 16, BOTTOM = 280; const lines: PlacedLine[] = []; let page = 1; let y = TOP;
  for (const blk of blocks) {
    y += blk.gapBefore;
    const lh = blk.size * 0.45 + 1;
    for (const t of wrapText(blk.text, W, s => measure(s, blk.size, blk.bold))) {
      if (y + lh > BOTTOM) { page++; y = TOP; }
      lines.push({ page, x: L, y, size: blk.size, bold: blk.bold, text: t }); y += lh;
    }
  }
  return { pages: page, lines };
}
