// Ren kjerne for tellerapport på e-post (ingen Deno/nett). Brukes av vt-count-report-email og testes i vitest.
// Rapporten bygges bare fra lagrede, frosne verdier. Hash binder forhåndsvisning og sending til samme versjon.

export interface ReportCount { id: string; name: string; planned_date: string; status: string; revision: number; valuation_mode: string; valuation_date: string | null }
export interface ReportList { id: string; name: string; department: string; status: string }
export interface ReportLine {
  id: string; count_list_id: string; sort_order: number; snap_name: string; snap_sku: string | null; snap_location_name: string | null;
  snap_base_unit: string | null; snap_price_per_base: number | null; snap_price_source: string; snap_price_reason: string | null;
  state: string; counted_base: number | null; revision: number;
}

const STATE: Record<string, string> = { ikke_talt: "Ikke talt", talt: "Talt", null: "0 på lager", ikke_her: "Ikke på stedet", ma_kontrolleres: "Må kontrolleres" };
const nb = (n: number, d = 3) => n.toLocaleString("nb-NO", { maximumFractionDigits: d, useGrouping: false });
const csvCell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function isFinal(c: ReportCount): boolean { return c.status === "avsluttet"; }

/** Kanonisk CSV (semikolon, norsk desimalkomma). Samme inndata gir byte-lik utdata. */
export function buildReportCsv(count: ReportCount, lists: ReportList[], lines: ReportLine[]): string {
  const listName = new Map(lists.map(l => [l.id, `${l.department} · ${l.name}`]));
  const order = new Map(lists.map((l, i) => [l.id, i]));
  const rows = [...lines].sort((a, b) => (order.get(a.count_list_id) ?? 0) - (order.get(b.count_list_id) ?? 0) || a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const head = ["Liste", "Vare", "Varenr", "Plassering", "Status", "Mengde", "Enhet", "Pris per enhet", "Verdi", "Prisgrunnlag", "Linje-ID", "Revisjon"];
  const out = [
    `# ${isFinal(count) ? "Endelig" : "Foreløpig"} tellerapport;${count.name};${count.planned_date};tellingsrevisjon ${count.revision}`,
    head.join(";"),
  ];
  for (const l of rows) {
    const qty = l.counted_base;
    const value = qty != null && l.snap_price_per_base != null ? qty * l.snap_price_per_base : null;
    out.push([
      listName.get(l.count_list_id) ?? "", l.snap_name, l.snap_sku ?? "", l.snap_location_name ?? "", STATE[l.state] ?? l.state,
      qty == null ? "" : nb(qty), l.snap_base_unit ?? "", l.snap_price_per_base == null ? "" : nb(l.snap_price_per_base, 4),
      value == null ? (qty != null && qty > 0 ? "UTEN PRIS" : "") : nb(value, 2),
      l.snap_price_per_base == null ? `mangler (${l.snap_price_reason ?? "ukjent"})` : l.snap_price_source, l.id, String(l.revision),
    ].map(csvCell).join(";"));
  }
  return out.join("\r\n") + "\r\n";
}

export interface ReportTotals { valued: number; unpricedPositive: number; uncounted: number; review: number; lines: number }
export function reportTotals(lines: ReportLine[]): ReportTotals {
  let valued = 0, unpricedPositive = 0, uncounted = 0, review = 0;
  for (const l of lines) {
    if (l.state === "ikke_talt") uncounted++;
    if (l.state === "ma_kontrolleres") review++;
    if (l.counted_base != null && l.counted_base > 0) { if (l.snap_price_per_base == null) unpricedPositive++; else valued += l.counted_base * l.snap_price_per_base; }
  }
  return { valued: Math.round(valued * 100) / 100, unpricedPositive, uncounted, review, lines: lines.length };
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Minimal tekst-PDF (Helvetica, WinAnsi) — nok til et lesbart vedlegg uten tredjepartsbibliotek. */
export function buildSimplePdf(title: string, textLines: string[]): Uint8Array {
  const perPage = 60; const pages: string[][] = [];
  const all = [title, "", ...textLines];
  for (let i = 0; i < all.length; i += perPage) pages.push(all.slice(i, i + perPage));
  const esc = (s: string) => s.replace(/[\\()]/g, m => "\\" + m).replace(/[^\x20-\x7e\xa0-\xff]/g, "?");
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pagesId = objs.length + 1; objs.push("");
  const kids: number[] = [];
  for (const p of pages) {
    const content = "BT /F1 9 Tf 40 800 Td 12 TL " + p.map(l => `(${esc(l.slice(0, 140))}) '`).join(" ") + " ET";
    const c = add(`<< /Length ${latin1Len(content)} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(latin1Len(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = latin1Len(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
function latin1Len(s: string): number { return s.length; }

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
export interface MailInput { recipient: string; subject: string; message: string }
export function validateMail(i: MailInput): string | null {
  if (!EMAIL.test(i.recipient.trim()) || i.recipient.length > 254) return "Ugyldig mottakeradresse (én adresse).";
  if (!i.subject.trim() || i.subject.length > 200) return "Emne mangler eller er for langt.";
  if (i.message.length > 4000) return "Meldingen er for lang.";
  return null;
}
export function defaultSubject(c: ReportCount): string { return `${isFinal(c) ? "Tellerapport" : "Foreløpig tellerapport"}: ${c.name} (${c.planned_date})`; }

function b64(bytes: Uint8Array): string { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
const htmlEsc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));

/** Graph sendMail-kropp med vedlegg (fileAttachment). */
export function buildGraphMessage(i: MailInput, count: ReportCount, totals: ReportTotals, csv: string, pdf: Uint8Array, base: string) {
  const summary = `Verdi med pris: ${nb(totals.valued, 2)} kr · ${totals.unpricedPositive} talte varer uten pris · ${totals.uncounted} ikke talt · ${totals.review} må kontrolleres`;
  const csvBytes = new TextEncoder().encode("\ufeff" + csv);
  return {
    message: {
      subject: i.subject.trim(),
      body: { contentType: "HTML", content: `<p>${htmlEsc(i.message).replace(/\n/g, "<br>")}</p><p>${htmlEsc(isFinal(count) ? "Endelig rapport." : "FORELØPIG rapport — tellingen er ikke avsluttet.")}</p><p>${htmlEsc(summary)}</p>` },
      toRecipients: [{ emailAddress: { address: i.recipient.trim() } }],
      attachments: [
        { "@odata.type": "#microsoft.graph.fileAttachment", name: `${base}.csv`, contentType: "text/csv", contentBytes: b64(csvBytes) },
        { "@odata.type": "#microsoft.graph.fileAttachment", name: `${base}.pdf`, contentType: "application/pdf", contentBytes: b64(pdf) },
      ],
    },
    saveToSentItems: true,
  };
}

/** Graph-utfall: 202 = akseptert av e-posttjenesten (ikke bevis for levering). */
export function classifyGraph(status: number | null): "akseptert_av_tjenesten" | "avvist" | "ukjent" {
  if (status === 202) return "akseptert_av_tjenesten";
  if (status != null && status >= 400 && status < 500 && status !== 408 && status !== 429) return "avvist";
  return "ukjent";
}
