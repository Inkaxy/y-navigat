import { LINE_STATE_LABEL, priceReasonLabel, summarize, summarizeGroups, type CountSummary } from "./logic";
import type { VtCount, VtCountLine, VtCountList } from "./types";

/** Frosne verdier til rapport/eksport. Leser aldri dagens pris. */
export interface ReportData { count: VtCount; lists: VtCountList[]; lines: VtCountLine[]; generatedAt: string }

const nb = (n: number, max = 6) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: max, useGrouping: false }).format(n);
const kr = (n: number) => new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const dateNo = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");

export const isFinalReport = (c: VtCount) => c.status === "avsluttet";
export function reportTitle(d: ReportData): string {
  return `${d.count.name}${isFinalReport(d.count) ? "" : " — FORELØPIG"}`;
}
/** Linjeverdi i øre (presis), null når mengde eller pris mangler. */
export function lineValueOre(l: VtCountLine): number | null {
  if (l.state === "null") return 0;
  if (l.state !== "talt" || l.counted_base == null || l.snap_price_per_base == null) return null;
  return Math.round(l.counted_base * l.snap_price_per_base * 100);
}

function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // hindre formeltolkning i regneark
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
export function buildCsv(d: ReportData): string {
  const listOf = new Map(d.lists.map(l => [l.id, l]));
  const head = ["Telling", "Status", "Verdsettelsesdato", "Liste", "Avdeling", "Sted", "Varenr", "Vare", "Registrering", "Mengde", "Enhet",
    "Pris per enhet (NOK eks. mva)", "Priskilde", "Pris virkningsdato", "Verdi (NOK)", "Merknad", "Linje-ID"];
  const rows = d.lines.map(l => {
    const list = listOf.get(l.count_list_id);
    const v = lineValueOre(l);
    return [d.count.name, isFinalReport(d.count) ? "Avsluttet" : `Foreløpig ${d.generatedAt}`, d.count.valuation_date ?? "", list?.name ?? "", list?.department ?? "",
      l.snap_location_name ?? "", l.snap_sku ?? "", l.snap_name, LINE_STATE_LABEL[l.state], l.counted_base == null ? "" : nb(l.counted_base),
      l.snap_base_unit ?? "ukjent", l.snap_price_per_base == null ? "" : nb(l.snap_price_per_base),
      l.snap_price_per_base == null ? priceReasonLabel(l.snap_price_reason) : l.snap_price_source === "historisk_dokumentert" ? "Historisk dokumentert" : "Dokumentert kostpris",
      l.snap_price_effective_date ?? "", v == null ? "" : kr(v / 100), l.note ?? "", l.id];
  });
  return "\uFEFF" + [head, ...rows].map(r => r.map(csvCell).join(";")).join("\r\n");
}

function summaryLine(s: CountSummary): string {
  const value = s.value == null ? "—" : `${kr(s.value)} kr`;
  return `${s.lines - s.notCounted}/${s.lines} registrert · verdi ${value}${s.countedWithoutPrice ? ` · UFULLSTENDIG: ${s.countedWithoutPrice} uten pris` : ""}${s.review ? ` · ${s.review} må kontrolleres` : ""}`;
}

/** PDF-rapport (A4) med frosne verdier. Returnerer Blob; ingen nettverk. */
export async function buildPdf(d: ReportData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = 16;
  const line = (t: string, size = 10, bold = false) => {
    if (y > 282) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size);
    for (const part of doc.splitTextToSize(t, 182)) { doc.text(part, 14, y); y += size * 0.45 + 1; }
  };
  line(reportTitle(d), 15, true);
  line(`Telledato ${dateNo(d.count.planned_date)} · verdsettelse ${dateNo(d.count.valuation_date)} (${d.count.valuation_mode === "historisk" ? "historisk dokumentert pris" : "dokumentert pris ved start"}) · beløp i NOK eks. mva`);
  line(isFinalReport(d.count) ? `Avsluttet ${d.count.finished_at ?? ""}` : `Foreløpig rapport generert ${d.generatedAt}. Tallene kan endres.`);
  y += 2;
  line(`Hele tellingen: ${summaryLine(summarize(d.lines))}`, 11, true);
  const g = summarizeGroups(d.lists, d.lines);
  y += 2; line("Per avdeling", 11, true);
  for (const x of g.byDepartment) line(`${x.label}: ${summaryLine(x.summary)}`);
  y += 2; line("Per liste", 11, true);
  for (const x of g.byList) line(`${x.label}: ${summaryLine(x.summary)}`);
  const missing = d.lines.filter(l => l.state === "talt" && l.snap_price_per_base == null);
  if (missing.length) { y += 2; line("Talte varer uten pris (ikke regnet som 0)", 11, true); for (const l of missing) line(`${l.snap_name} — ${l.counted_base == null ? "" : nb(l.counted_base)} ${l.snap_base_unit ?? ""} — ${priceReasonLabel(l.snap_price_reason)}`); }
  for (const list of d.lists) {
    y += 3; line(`${list.department} · ${list.name} (malversjon ${list.source_template_revision})`, 11, true);
    for (const l of d.lines.filter(x => x.count_list_id === list.id)) {
      const v = lineValueOre(l);
      line(`${l.snap_sku ?? "—"}  ${l.snap_name}  ·  ${l.snap_location_name ?? "uten sted"}  ·  ${LINE_STATE_LABEL[l.state]}${l.counted_base != null ? ` ${nb(l.counted_base)} ${l.snap_base_unit ?? ""}` : ""}  ·  ${l.snap_price_per_base == null ? priceReasonLabel(l.snap_price_reason) : `${nb(l.snap_price_per_base)} kr/${l.snap_base_unit}`}  ·  ${v == null ? "—" : `${kr(v / 100)} kr`}`, 9);
    }
  }
  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const reportFileBase = (c: VtCount) => `varetelling-${c.planned_date}-${c.name.toLowerCase().replace(/[^a-z0-9æøå]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40)}`;

/** Maskinlesbar identitet trykt på hver side (for kommende skjemalesing). */
export function sheetIdentity(countId: string, list: VtCountList, page: number, pages: number): string {
  return `VT1|${countId}|${list.id}|r${list.source_template_revision}|s${page}/${pages}`;
}
/** Autentisert lenke til nøyaktig denne tellelisten. QR-koden gir ingen tilgang i seg selv. */
export function listDeepLink(origin: string, countId: string, list: VtCountList, page?: number): string {
  const q = new URLSearchParams({ fane: "telling", telling: countId, liste: list.id, v: String(list.source_template_revision) });
  if (page) q.set("side", String(page));
  return `${origin}/ravarer/lager?${q.toString()}`;
}
