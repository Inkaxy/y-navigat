// E-postspesifikk kjerne (ren TS). Innhold, verdier og CSV kommer fra den felles kontrakten _shared/vtReport.ts,
// så e-post, skjerm og nedlastet PDF/CSV regner likt. Her: PDF-gjengivelse uten DOM, Graph-melding, validering.
import { buildReportCsv, isFinal, layoutA4, reportBlocks, summarizeLines, type VtReportData } from "../_shared/vtReport.ts";

export { buildReportCsv, isFinal, summarizeLines };

const PT_PER_MM = 72 / 25.4;
/** Konservativ Helvetica-bredde (0,6 em per tegn) i mm — bryter heller for tidlig enn utenfor arket. */
export const measureHelvetica = (s: string, sizePt: number) => s.length * sizePt * 0.6 / PT_PER_MM;

function latin1(s: string): string { return s.replace(/[^\x20-\x7e\xa0-\xff]/g, "?"); }
const esc = (s: string) => latin1(s).replace(/[\\()]/g, m => "\\" + m);

/** Fullstendig, paginert A4-PDF fra samme blokker/oppsett som nedlastet PDF (ingen tekst kastes). */
export function buildReportPdf(d: VtReportData): Uint8Array {
  const lay = layoutA4(reportBlocks(d), (s, size) => measureHelvetica(s, size));
  const objs: string[] = []; const add = (s: string) => { objs.push(s); return objs.length; };
  const fReg = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pagesId = objs.length + 1; objs.push("");
  const kids: number[] = [];
  for (let p = 1; p <= lay.pages; p++) {
    const ops: string[] = [];
    for (const l of lay.lines.filter(x => x.page === p)) ops.push(`BT /${l.bold ? "F2" : "F1"} ${l.size} Tf ${(l.x * PT_PER_MM).toFixed(2)} ${(842 - l.y * PT_PER_MM).toFixed(2)} Td (${esc(l.text)}) Tj ET`);
    ops.push(`BT /F1 8 Tf ${(14 * PT_PER_MM).toFixed(2)} ${(842 - 290 * PT_PER_MM).toFixed(2)} Td (${esc(`Side ${p} av ${lay.pages}`)}) Tj ET`);
    const content = ops.join("\n");
    const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fReg} 0 R /F2 ${fBold} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

export function b64(bytes: Uint8Array): string { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
/** Versjons-hash over NØYAKTIG vedleggene som forhåndsvises og sendes. */
export const attachmentHash = (csv: string, pdfB64: string) => sha256Hex(`${csv}\n--pdf--\n${pdfB64}`);

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export interface MailInput { recipient: string; subject: string; message: string }
export function validateMail(i: MailInput): string | null {
  if (!EMAIL.test(i.recipient.trim()) || i.recipient.length > 254) return "Ugyldig mottakeradresse (én adresse).";
  if (!i.subject.trim() || i.subject.length > 200) return "Emne mangler eller er for langt.";
  if (i.message.length > 4000) return "Meldingen er for lang.";
  return null;
}
export const defaultSubject = (d: VtReportData) => `${isFinal(d.count) ? "Tellerapport" : "Foreløpig tellerapport"}: ${d.count.name} (${d.count.planned_date})`;
export const attachmentBase = (d: VtReportData) => `varetelling-${d.count.planned_date}-r${d.count.revision}`;
const htmlEsc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));

export function buildGraphMessage(i: MailInput, final: boolean, csv: string, pdfB64: string, base: string) {
  return {
    message: {
      subject: i.subject.trim(),
      body: { contentType: "HTML", content: `<p>${htmlEsc(i.message).replace(/\n/g, "<br>")}</p><p>${final ? "Endelig rapport." : "FORELØPIG rapport — tellingen er ikke avsluttet."} Se vedlagt PDF og CSV.</p>` },
      toRecipients: [{ emailAddress: { address: i.recipient.trim() } }],
      attachments: [
        { "@odata.type": "#microsoft.graph.fileAttachment", name: `${base}.csv`, contentType: "text/csv", contentBytes: b64(new TextEncoder().encode(csv)) },
        { "@odata.type": "#microsoft.graph.fileAttachment", name: `${base}.pdf`, contentType: "application/pdf", contentBytes: pdfB64 },
      ],
    },
    saveToSentItems: true,
  };
}
/** Graph: 202 = akseptert av e-posttjenesten (ikke bevis for levering). */
export function classifyGraph(status: number | null): "akseptert_av_tjenesten" | "avvist" | "ukjent" {
  if (status === 202) return "akseptert_av_tjenesten";
  if (status != null && status >= 400 && status < 500 && status !== 408 && status !== 429) return "avvist";
  return "ukjent";
}
