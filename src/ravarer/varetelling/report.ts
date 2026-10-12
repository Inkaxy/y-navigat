import { buildReportCsv, layoutA4, reportBlocks } from "../../../supabase/pending/functions/_shared/vtReport";
import type { VtCount, VtCountLine, VtCountList } from "./types";

/** Frosne verdier til rapport/eksport. Leser aldri dagens pris. */
export interface ReportData { count: VtCount; lists: VtCountList[]; lines: VtCountLine[]; generatedAt: string }


export const isFinalReport = (c: VtCount) => c.status === "avsluttet";
export function reportTitle(d: ReportData): string {
  return `${d.count.name}${isFinalReport(d.count) ? "" : " — FORELØPIG"}`;
}
export { lineValueOre } from "../../../supabase/pending/functions/_shared/vtReport";

/** CSV fra felles kontrakt (samme tilstander, verdier og formelvern som e-post). */
export function buildCsv(d: ReportData): string { return buildReportCsv(d); }

/** PDF (A4) fra felles innhold; sidebrudd før hver brutte linje, «Side X av Y». */
export async function buildPdf(d: ReportData): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const measure = (t: string, size: number, bold: boolean) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); return doc.getTextWidth(t); };
  const lay = layoutA4(reportBlocks(d), measure);
  for (let p = 1; p <= lay.pages; p++) {
    if (p > 1) doc.addPage();
    for (const l of lay.lines.filter(x => x.page === p)) { doc.setFont("helvetica", l.bold ? "bold" : "normal"); doc.setFontSize(l.size); doc.text(l.text, l.x, l.y); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(`Side ${p} av ${lay.pages}`, 14, 290);
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
