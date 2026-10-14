import { assertEquals } from "jsr:@std/assert@1";
import { alignLineRow, readPdfText } from "../_shared/pdfText.ts";
import { fetchVerifiedOriginal } from "../_shared/invoiceOriginal.ts";

/** Minimal PDF med to tekstrader (syntetisk, ingen ekte faktura). */
function tinyPdf(lines: string[]): Uint8Array {
  const content = lines.map((l, i) => `BT /F1 10 Tf 40 ${780 - i * 14} Td (${l}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new TextEncoder().encode(out);
}

Deno.test("unpdf leser tekstlag i Deno-runtime og finner fullt varenummer", async () => {
  const pdf = tinyPdf(["5301 0 HASSELNOTTER HELE 10 kg 113,00 1130,00", "6541 1 TRANEBAER 11,34 kg 86,00 975,24", "Sum varer 2105,24 og flere ord her"]);
  const r = await readPdfText(pdf, undefined, { maxBytes: 1e6, maxPages: 5, maxChars: 10000, timeoutMs: 8000, minCharsPerPage: 10 });
  assertEquals(r.status, "ok");
  const hit = alignLineRow(r, "5301 0", "Hasselnøtter");
  assertEquals(hit.by, "sku");
  // «5301» alene er et annet nummer og skal ikke treffe «5301 0»-raden.
  assertEquals(alignLineRow(r, "5301", null).by, "ingen");
});

Deno.test("tidsavbrudd og feil gir fallback, aldri ok", async () => {
  const slow = () => new Promise<never>(() => {});
  const r = await readPdfText(new Uint8Array(10), slow, { maxBytes: 100, maxPages: 1, maxChars: 10, timeoutMs: 20, minCharsPerPage: 1 });
  assertEquals(r.status, "tidsavbrudd");
  const bad = await readPdfText(new Uint8Array(10), () => Promise.reject(new Error("x")));
  assertEquals(bad.status, "feil");
  assertEquals((await readPdfText(new Uint8Array(200), undefined, { maxBytes: 100, maxPages: 1, maxChars: 1, timeoutMs: 1, minCharsPerPage: 1 })).status, "for_stor");
});

Deno.test("original: endret versjon etter nedlasting avvises", async () => {
  let n = 0;
  const r = await fetchVerifiedOriginal({
    maxBytes: 100,
    documentVersion: () => Promise.resolve({ ok: true, available: true, path: "p", version: n++ === 0 ? "v1" : "v2" }),
    download: () => Promise.resolve(new Uint8Array(5)),
  });
  assertEquals(r.status, "endret");
  assertEquals(r.bytes, null);
  const missing = await fetchVerifiedOriginal({ maxBytes: 100, documentVersion: () => Promise.resolve({ ok: true, available: false }), download: () => Promise.resolve(null) });
  assertEquals(missing.status, "mangler");
});
