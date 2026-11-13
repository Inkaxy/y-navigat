// Deler en PDF i sidebolker for oppdelt lesing av lange fakturaer (Deno, pinned pdf-lib).
// Feiler delingen (kryptert/ødelagt PDF), returneres null og lesingen går som før.
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import type { PageChunk } from "../_shared/chunkedExtraction.ts";

export async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

/** Én base64-PDF per bolk, eller null når dokumentet ikke kan deles. */
export async function splitPdf(bytes: Uint8Array, chunks: readonly PageChunk[]): Promise<string[] | null> {
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const out: string[] = [];
    for (const c of chunks) {
      const part = await PDFDocument.create();
      const idx = Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from - 1 + i);
      const pages = await part.copyPages(src, idx);
      for (const p of pages) part.addPage(p);
      out.push(encodeBase64(await part.save()));
    }
    return out;
  } catch {
    return null;
  }
}
